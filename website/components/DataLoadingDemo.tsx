import RunnableExample from './RunnableExample';

const code = `el.style.display = 'flex';
el.style.flexDirection = 'column';
const controls = document.createElement('div');
controls.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:8px;min-height:48px;flex-shrink:0';
const stage = document.createElement('div');
stage.style.cssText = 'flex:1;min-height:0';
el.append(controls, stage);
const now = 1789093800;
const bars = Array.from({ length: 360 }, (_, index) => {
  const close = 23800 + Math.sin(index / 12) * 32;
  return { time: now - (359 - index) * 60, open: close - 2,
    high: close + 4, low: close - 5, close, volume: (index % 12 + 1) * 65 };
});
let failNext = false;
let empty = false;
let requests = 0;
let reconnect;
const counter = document.createElement('span');
counter.style.cssText = 'font:12px system-ui;padding:7px';
const source = {
  async getBars(request) {
    counter.textContent = 'History requests: ' + ++requests;
    await new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(new Error('Cancelled')); };
      const timer = setTimeout(() => {
        request.signal?.removeEventListener('abort', stop);
        resolve();
      }, 700);
      request.signal?.addEventListener('abort', stop, { once: true });
      if (request.signal?.aborted) stop();
    });
    if (failNext) { failNext = false; throw new Error('Simulated connection failure'); }
    if (empty) return [];
    return bars.filter(bar => bar.time >= request.from && bar.time <= request.to);
  },
  async getBarsPage(request) {
    const older = await this.getBars({ ...request, from: bars[0].time });
    return { bars: older.slice(-60), hasMore: older.length > 60 };
  },
  subscribeBars(request, onBar, options) {
    reconnect = options.onResync;
    let ticks = 0;
    const timer = setInterval(() => {
      if (empty) return;
      const last = bars[bars.length - 1];
      const close = last.close + Math.sin(++ticks / 3) * 2;
      onBar({ ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close) });
    }, 800);
    return () => clearInterval(timer);
  },
};
const feed = lib.withBarCache(source, { now: () => now * 1000 });
const widget = lib.createWidget(stage, {
  feed, symbol: 'NIFTY SIM', exchange: 'NFO', interval: '1m', intervals: ['1m'],
  rail: false, indicators: false, lookbackBars: 120, loading: { now: () => now, pageSize: 60 },
  navigation: { defaultVisibleBars: 100 },
});
function button(label, action) {
  const button = document.createElement('button');
  button.textContent = label;
  button.type = 'button';
  button.style.cssText = 'padding:5px 9px;border:1px solid #64748b;border-radius:4px;font:12px system-ui';
  button.addEventListener('click', action);
  controls.appendChild(button);
}
button('Load older', () => void widget.dataController.loadMore());
button('Fail refresh', () => { failNext = true; void widget.reload(); });
button('Reconnect', () => reconnect?.());
button('Pause / resume display', () => {
  widget.dataController.setPaused(!widget.dataController.getState().paused);
});
button('Empty / restore', () => {
  empty = !empty;
  widget.setSymbol(empty ? 'EMPTY SIM' : 'NIFTY SIM', 'NFO');
});
controls.appendChild(counter);
return widget;`;

export default function DataLoadingDemo() {
  return <RunnableExample height={440} tiers={['widget']} code={code} watermark={false}
    caption="Simulated NIFTY around 23,800. Fail a refresh, then use Retry on the chart. Pause holds the display while live data continues; it does not start historical replay." />;
}
