/**
 * Composed OpenAlgo live data feed (resolves audit V2-M1). Implements the full
 * `DataFeed` contract by combining history (REST), live ticks (WS), and a
 * per-subscription aggregator, so `subscribeBars()` actually delivers live
 * interval bars instead of being a no-op trap.
 */
import type { Bar } from '../model/bar';
import type { BarsRequest, DataFeed, MarketDepth, UnsubscribeFn } from './types';
import { OpenAlgoDataFeed, type OpenAlgoConfig } from './openalgo-rest';
import { OpenAlgoWsFeed, type SocketFactory, type LtpEvent } from './openalgo-ws';
import { CandleBuilder, type VolumeMode } from './candle-builder';
import { resolveInterval, isTimeBucketed, type Bucketing, type IntervalBucketing } from './intervals';
import { TickBarAggregator } from './tick-aggregator';

export interface OpenAlgoLiveConfig extends OpenAlgoConfig {
  /** WS proxy URL, e.g. ws://127.0.0.1:8765. */
  wsUrl: string;
  /** Volume accounting for the live candle builder (default 'ltq-sum'). */
  volumeMode?: VolumeMode;
  /**
   * Zone calendar intervals bucket in (default IST). Should be the chart's
   * configured timezone: a monthly bar opens at local midnight on the first,
   * and that instant differs by exchange.
   */
  timezone?: string;
  /** Inject a custom socket (tests, React Native, non-browser runtimes). */
  socketFactory?: SocketFactory;
}

/**
 * Seconds per bar for a fixed-length interval code, e.g. `D` -> 86400,
 * `1m` -> 60, `1h` -> 3600.
 *
 * Throws `UnknownIntervalError` for a code nothing recognises, and a plain
 * error for a calendar or count-driven code, which has no seconds to give.
 * It used to answer 60 for both, which drew minute bars under whatever label
 * the caller thought it had asked for.
 *
 * Prefer `resolveInterval()` and `bucketStartOf()`: they cover every registered
 * code, not just the ones that happen to have a fixed length.
 */
export function intervalToSeconds(interval: string): number {
  const { bucketing } = resolveInterval(interval);
  if (bucketing.mode !== 'interval') {
    throw new Error(
      `openalgo-charts: interval "${interval}" is ${bucketing.mode}-bucketed and has no fixed length. `
      + 'Use resolveInterval() and bucketStartOf() instead of intervalToSeconds().',
    );
  }
  return bucketing.seconds;
}

/**
 * Per-tick quantity for the aggregator path, honouring the configured volume
 * mode. `day-delta` feeds arrive as a cumulative day total, so the bar wants
 * the difference; a total that went backwards is the daily reset, and the new
 * value is then the first delta of the new day.
 */
function volumeDeltaReader(mode: VolumeMode, cumSoFar?: number): (e: LtpEvent) => number {
  if (mode === 'ltq-sum') return (e) => e.ltq ?? 0;
  let lastCum: number | null = cumSoFar ?? null;
  return (e) => {
    const cum = e.volume ?? 0;
    const delta = lastCum === null ? 0 : cum < lastCum ? cum : cum - lastCum;
    lastCum = cum;
    return Math.max(0, delta);
  };
}

export class OpenAlgoLiveDataFeed implements DataFeed {
  private readonly _rest: OpenAlgoDataFeed;
  private readonly _ws: OpenAlgoWsFeed;
  private readonly _volumeMode: VolumeMode;
  private readonly _timezone: string | undefined;

  public constructor(config: OpenAlgoLiveConfig) {
    this._rest = new OpenAlgoDataFeed(config);
    this._ws = new OpenAlgoWsFeed({ url: config.wsUrl, apiKey: config.apiKey, socketFactory: config.socketFactory });
    this._volumeMode = config.volumeMode ?? 'ltq-sum';
    this._timezone = config.timezone;
    this._ws.connect();
  }

  public getBars(req: BarsRequest): Promise<Bar[]> {
    return this._rest.getBars(req);
  }

  /**
   * Live bars: WS LTP -> aggregator -> onBar (mutated/append bar).
   *
   * Fixed intervals go through `CandleBuilder`, which carries the late-tick
   * policy; calendar, tick-count and volume intervals go through
   * `TickBarAggregator`, which is the one that knows those boundaries.
   *
   * Pass `opts.seedFrom` (the last history bar) to continue that bar's bucket
   * seamlessly instead of starting a fresh one, and `opts.cumDayVolumeSoFar` so
   * a `day-delta` builder diffs against the right baseline. Seeding applies to
   * time-bucketed intervals: a count-driven bar cannot resume a historical one.
   */
  public subscribeBars(
    req: BarsRequest,
    onBar: (bar: Bar) => void,
    opts?: { seedFrom?: Bar; cumDayVolumeSoFar?: number },
  ): UnsubscribeFn {
    // Resolve up front: a bad interval code fails here, at subscribe time, and
    // not silently on every tick for the life of the subscription.
    const { bucketing } = resolveInterval(req.interval);
    const onEvent = bucketing.mode === 'interval'
      ? this._candleReader(bucketing.seconds, onBar, opts)
      : this._aggregatorReader(bucketing, onBar, opts);

    const off = this._ws.onLtp((e) => {
      // Match both symbol and exchange (a broker can multiplex venues on one socket).
      if (e.symbol !== req.symbol) return;
      if (e.exchange && req.exchange && e.exchange !== req.exchange) return;
      onEvent(e);
    });
    this._ws.subscribe('LTP', req.symbol, req.exchange);
    return () => { off(); this._ws.unsubscribe('LTP', req.symbol, req.exchange); };
  }

  /** A broker may omit the tick timestamp; never bucket at the epoch, use now. */
  private static _tickTime(e: LtpEvent): number {
    return e.timeSec && e.timeSec > 0 ? e.timeSec : Math.floor(Date.now() / 1000);
  }

  private _candleReader(
    intervalSec: number,
    onBar: (bar: Bar) => void,
    opts?: { seedFrom?: Bar; cumDayVolumeSoFar?: number },
  ): (e: LtpEvent) => void {
    const builder = new CandleBuilder({ intervalSec, volumeMode: this._volumeMode });
    if (opts?.seedFrom) builder.seed(opts.seedFrom, opts.cumDayVolumeSoFar);
    return (e) => {
      // cumDayVolume is only consumed in 'day-delta' mode; harmless otherwise.
      const u = builder.onTick({
        time: OpenAlgoLiveDataFeed._tickTime(e), price: e.ltp, ltq: e.ltq, cumDayVolume: e.volume,
      });
      if (u !== null) onBar(u.bar);
    };
  }

  private _aggregatorReader(
    bucketing: Exclude<Bucketing, IntervalBucketing>,
    onBar: (bar: Bar) => void,
    opts?: { seedFrom?: Bar; cumDayVolumeSoFar?: number },
  ): (e: LtpEvent) => void {
    const agg = new TickBarAggregator(bucketing, { timezone: this._timezone });
    if (opts?.seedFrom && isTimeBucketed(bucketing)) agg.seed(opts.seedFrom);
    const qtyOf = volumeDeltaReader(this._volumeMode, opts?.cumDayVolumeSoFar);
    return (e) => {
      const u = agg.onTick({ time: OpenAlgoLiveDataFeed._tickTime(e), price: e.ltp, qty: qtyOf(e) });
      onBar(u.bar);
    };
  }

  public subscribeDepth(req: BarsRequest, onDepth: (depth: MarketDepth) => void): UnsubscribeFn {
    const off = this._ws.onDepth((symbol, ex, depth) => {
      if (symbol !== req.symbol) return;
      if (ex && req.exchange && ex !== req.exchange) return;
      onDepth(depth);
    });
    this._ws.subscribe('Depth', req.symbol, req.exchange);
    return () => { off(); this._ws.unsubscribe('Depth', req.symbol, req.exchange); };
  }

  public close(): void {
    this._ws.close();
  }
}
