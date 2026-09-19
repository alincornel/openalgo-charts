import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDom, flatBar } from './helpers.js';

vi.mock('../src/feed.js', () => ({ fetchBars: vi.fn(), abortFetch: vi.fn() }));
vi.mock('../src/toolbar.js', () => ({ renderToolbar: vi.fn(), ticon: () => '' }));
vi.mock('../src/status.js', () => ({ setLegend: vi.fn(), barStamp: () => '' }));
import { fetchBars, abortFetch } from '../src/feed.js';
import { initReplay, startReplayAt, exitReplay, loadReplaySubBars } from '../src/replay.js';

describe('reference replay transitions', () => {
  let app;
  beforeEach(() => {
    fakeDom();
    document.addEventListener = () => {};
    globalThis.window = { addEventListener() {} };
    app = { chart: { panes: () => [] }, price: { getData: () => [flatBar(1, 10), flatBar(2, 11)] },
      req: { symbol: 'FIRST', interval: '1d', period: '1mo' }, currentBars: [],
      replay: null, replayPicking: false, replayShades: [], alerts: { setPaused: vi.fn() } };
    initReplay(app);
    vi.clearAllMocks();
  });
  afterEach(() => { delete globalThis.window; });

  it('locks before loading and rejects a result after cancellation', async () => {
    let resolve;
    fetchBars.mockReturnValue(new Promise(done => { resolve = done; }));
    const start = startReplayAt(0);
    expect(app.replayLoading).toBe(true);
    expect(app.alerts.setPaused).toHaveBeenLastCalledWith(true);
    exitReplay();
    expect(app.replayLoading).toBe(false);
    expect(abortFetch).toHaveBeenCalledWith('replay');
    resolve([flatBar(1, 10), flatBar(2, 11)]);
    await start;
    expect(app.replay).toBeNull();
    expect(app.alerts.setPaused).toHaveBeenLastCalledWith(false);
  });

  it('keys finer history by instrument and period as well as interval', async () => {
    fetchBars.mockResolvedValue([flatBar(1, 10)]);
    await loadReplaySubBars();
    app.req.symbol = 'SECOND';
    await loadReplaySubBars();
    app.req.period = '3mo';
    await loadReplaySubBars();
    expect(fetchBars.mock.calls.map(call => call.slice(0, 3))).toEqual([
      ['FIRST', '60m', '1mo'], ['SECOND', '60m', '1mo'], ['SECOND', '60m', '3mo'],
    ]);
  });
});
