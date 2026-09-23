import { describe, expect, it, vi } from 'vitest';
import {
  migrateWidgetWorkspace, parseIndicatorTemplate, parseWorkspaceDocument, parseWorkspacePayload,
  WorkspaceDocumentError,
} from '../src/workspace/index';
import { workspaceFixture } from './helpers/workspace-fixture';
import { Chart } from '../src/core/chart';
import { fakeDocument } from './helpers/fake-dom';

const template = () => ({
  kind: 'indicator-template', version: 1, id: 'study-set', name: 'Trend', createdAt: 1000, updatedAt: 2000,
  indicators: workspaceFixture().panes[0].chart.indicators,
});

describe('workspace documents', () => {
  it('retains optional appearance sync and rejects invalid values', () => {
    const fixture = workspaceFixture();
    const input = { ...fixture, sync: { ...fixture.sync, appearance: true } };
    expect(parseWorkspaceDocument(input).sync).toEqual(input.sync);
    expect(() => parseWorkspaceDocument({ ...input, sync: { ...input.sync, appearance: 'yes' } })).toThrow();
  });
  it('preserves the full state emitted by an actual chart, including its settings and timezone', () => {
    const doc = fakeDocument();
    const chart = new Chart(doc.createElement('div'), { document: doc, shortcuts: false, raf: { schedule: () => 0 } });
    try {
      chart.applySize(800, 600);
      chart.addSeries('candlestick');
      chart.setTimezone('America/New_York');
      chart.setPriceScaleOptions({ mode: 'logarithmic' });
      const state = chart.getState();
      const input = workspaceFixture();
      const saved = parseWorkspaceDocument({ ...input, panes: [{ ...input.panes[0], chart: state }, input.panes[1]] });
      expect(saved.panes[0].chart).toEqual(state);
    } finally { chart.destroy(); }
  });

  it('round-trips independent panes, grid, settings, drawings and comparisons', () => {
    const input = workspaceFixture();
    const saved = parseWorkspaceDocument(JSON.stringify(input));
    expect(saved).toEqual(input);
    expect(saved.panes.map(p => p.interval)).toEqual(['5m', '1h']);
    input.panes[0].chart.indicators[0].settings.period = 999;
    expect(saved.panes[0].chart.indicators![0].settings.period).toBe(9);
    expect(parseWorkspacePayload(saved).panes).toEqual(saved.panes);
  });

  it('retains unequal grid tracks as detached portable weights', () => {
    const fixture = workspaceFixture();
    const input = { ...fixture, layout: { ...fixture.layout, rowWeights: [1], columnWeights: [1.4, 1] } };
    const saved = parseWorkspaceDocument(JSON.stringify(input));
    expect(saved.layout).toEqual(input.layout);
    const detached = parseWorkspacePayload(input);
    input.layout.columnWeights[0] = 9;
    input.layout.rowWeights[0] = 4;
    expect(detached.layout.columnWeights).toEqual([1.4, 1]);
    expect(detached.layout.rowWeights).toEqual([1]);
    const legacy = parseWorkspaceDocument(fixture);
    expect(legacy.layout).not.toHaveProperty('rowWeights');
    expect(legacy.layout).not.toHaveProperty('columnWeights');
  });

  it.each([
    { rowWeights: [] }, { rowWeights: [1, 2] }, { columnWeights: [1] },
    { columnWeights: [0, 1] }, { columnWeights: [-1, 1] },
    { columnWeights: [NaN, 1] }, { columnWeights: [Infinity, 1] },
    { columnWeights: [1001, 1] }, { columnWeights: ['2', 1] },
  ])('rejects invalid grid track weights: %j', (weights) => {
    const fixture = workspaceFixture();
    expect(() => parseWorkspaceDocument({ ...fixture, layout: { ...fixture.layout, ...weights } }))
      .toThrow(WorkspaceDocumentError);
  });

  it('projects configuration and drops nested credentials and execution state', () => {
    const input = workspaceFixture();
    Object.assign(input, { apiKey: 'secret-value', armed: true, orders: [{ id: 'live' }], unknown: 'ignored' });
    Object.assign(input.panes[0].chart.indicators[0].settings, {
      credentials: { token: 'secret-value' }, 'api_key': 'secret-value', accessToken: 'secret-value',
    });
    Object.assign(input.panes[0].chart.drawings.drawings[0], { positions: [{ account: 'secret-value' }] });
    Object.assign(input.panes[0].chart, { data: [{ close: 500 }], accountBalance: 999 });
    const text = JSON.stringify(parseWorkspaceDocument(input));
    expect(text).not.toMatch(/secret-value|armed|orders|positions|accountBalance|unknown|"data"/);
    expect(text).toContain('line1');
  });

  it('does not execute accessors and rejects non-JSON values and cycles', () => {
    const accessor = vi.fn(() => 'unsafe');
    const input = workspaceFixture();
    Object.defineProperty(input, 'extra', { enumerable: true, get: accessor });
    expect(() => parseWorkspaceDocument(input)).toThrow(WorkspaceDocumentError);
    expect(accessor).not.toHaveBeenCalled();
    for (const bad of [() => 1, NaN, Infinity, new Date(), undefined, 1n]) {
      expect(() => parseWorkspaceDocument({ ...workspaceFixture(), extra: bad })).toThrow(WorkspaceDocumentError);
    }
    const cyclic: Record<string, unknown> = workspaceFixture();
    cyclic.cycle = cyclic;
    expect(() => parseWorkspaceDocument(cyclic)).toThrow(/cycle/i);
  });

  it('discards prototype keys without polluting any returned object', () => {
    const input = JSON.parse(JSON.stringify(workspaceFixture()));
    input.panes[0].settings = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"volume.showMA":true}');
    const saved = parseWorkspaceDocument(input);
    expect(saved.panes[0].settings).toEqual({ 'volume.showMA': true });
    expect(Object.getPrototypeOf(saved.panes[0].settings)).toBe(Object.prototype);
    expect('polluted' in {}).toBe(false);
  });

  it.each([
    ['future schema', { version: 99 }], ['wrong kind', { kind: 'orders' }],
    ['blank name', { name: '   ' }], ['long name', { name: 'x'.repeat(121) }],
    ['invalid clock', { updatedAt: -1 }], ['missing focused pane', { activePaneId: 'absent' }],
    ['empty workspace', { panes: [] }],
    ['invalid dimension', { layout: { ...workspaceFixture().layout, rows: 0 } }],
    ['fractional dimension', { layout: { ...workspaceFixture().layout, rows: 1.5 } }],
    ['invalid sync', { sync: { ...workspaceFixture().sync, interval: 'yes' } }],
  ])('rejects %s', (_name, patch) => {
    expect(() => parseWorkspaceDocument({ ...workspaceFixture(), ...patch })).toThrow(WorkspaceDocumentError);
  });

  it('rejects duplicate pane identities, invalid slots, overlaps and missing slots', () => {
    const input = workspaceFixture();
    const slots = input.layout.slots;
    const badSlots = [
      [slots[0]], [slots[0], { ...slots[1], column: 0 }],
      [slots[0], { ...slots[1], columnSpan: 2 }],
      [slots[0], { ...slots[1], paneId: 'unknown' }], [slots[0], slots[0]],
    ];
    for (const next of badSlots) {
      expect(() => parseWorkspaceDocument({ ...input, layout: { ...input.layout, slots: next } })).toThrow();
    }
    expect(() => parseWorkspaceDocument({ ...input, panes: [input.panes[0], input.panes[0]] })).toThrow();
  });

  it('rejects unsupported chart versions and malformed indicator/scale state', () => {
    for (const chart of [
      { version: 99 }, { version: 1, indicators: [{}] }, { version: 1, viewport: { from: 10, to: 1 } },
      { version: 1, panes: [{ weight: -1 }] }, { version: 1, drawings: 'not a drawing document' },
    ]) {
      const input = workspaceFixture();
      expect(() => parseWorkspaceDocument({ ...input, panes: [{ ...input.panes[0], chart }, input.panes[1]] })).toThrow();
    }
  });

  it('bounds depth, total nodes and serialized size before accepting imports', () => {
    let deep: unknown = {};
    for (let i = 0; i < 40; i++) deep = { next: deep };
    expect(() => parseWorkspaceDocument({ ...workspaceFixture(), deep })).toThrow(/depth/i);
    expect(() => parseWorkspaceDocument({ ...workspaceFixture(), huge: Array(100001).fill(1) })).toThrow(/limit/i);
    expect(() => parseWorkspaceDocument(' '.repeat(5 * 1024 * 1024 + 1))).toThrow(/limit/i);
    expect(() => parseWorkspaceDocument({ ...workspaceFixture(), text: 'x'.repeat(5 * 1024 * 1024) })).toThrow(/limit/i);
  });

  it('migrates the existing widget envelope without changing or executing its source', () => {
    const source = { version: 1, symbol: 'BHEL', exchange: 'NSE', interval: '5m', chartType: 'candlestick',
      theme: 'light', chart: workspaceFixture().panes[0].chart,
      rail: { favorites: [], magnet: 'strong', stay: true, last: {} }, armed: true,
    };
    const saved = migrateWidgetWorkspace(source, { id: 'migrated', name: 'Previous chart', now: 5000 });
    expect(saved.activePaneId).toBe('p0');
    expect(saved.layout.slots).toHaveLength(1);
    expect(saved.panes[0]).toMatchObject({ symbol: 'BHEL', interval: '5m', magnet: 'strong', stay: true, settings: { 'widget.theme': 'light' } });
    expect(saved.panes[0].chart).toEqual(source.chart);
    expect(source.armed).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('armed');
    expect(() => migrateWidgetWorkspace({ version: 2 }, { id: 'x', name: 'Old', now: 0 })).toThrow();
  });
});

describe('indicator template documents', () => {
  it('retains duplicate instances, plot styles, visibility and custom descriptor identities', () => {
    const input = template();
    input.indicators.push({ ...input.indicators[0], indicatorId: 'custom-study', paneIndex: 1 });
    const parsed = parseIndicatorTemplate(input);
    expect(parsed.indicators).toEqual(input.indicators);
    input.indicators[0].settings.period = 500;
    expect(parsed.indicators[0].settings.period).toBe(9);
  });

  it('accepts an intentionally empty template and trims its name', () => {
    expect(parseIndicatorTemplate({ ...template(), indicators: [], name: '  Clear studies  ' }))
      .toMatchObject({ indicators: [], name: 'Clear studies' });
  });

  it.each([
    [{ indicatorId: '', settings: {}, paneIndex: 0 }],
    [{ indicatorId: 'ema', settings: [], paneIndex: 0 }],
    [{ indicatorId: 'ema', settings: {}, paneIndex: -1 }],
    [{ indicatorId: 'ema', settings: {}, paneIndex: 0, visible: 'yes' }],
    Array(257).fill({ indicatorId: 'ema', settings: {}, paneIndex: 0 }),
  ])('rejects malformed or oversized indicator arrays', (...entries) => {
    expect(() => parseIndicatorTemplate({ ...template(), indicators: entries })).toThrow();
  });
});
