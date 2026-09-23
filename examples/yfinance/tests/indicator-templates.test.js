import { describe, it, expect, vi } from 'vitest';
vi.mock('/dist/openalgo-charts.mjs', async original => ({ ...await original(),
  registeredIndicators: () => ['ema', 'rsi', 'macd'].map(id => ({ id })) }));
import { captureIndicatorTemplate, applyIndicatorTemplate, templateUnavailableReason } from '../src/indicator-templates.js';

const study = (patch = {}) => ({ indicatorId: 'ema', settings: { length: 9, color: '#12abcd' },
  paneIndex: 0, instanceId: 'original', visible: false, ...patch });

function setup(pane = 1) {
  let valid = true;
  const original = { version: 1, indicators: [study()], drawings: { version: 2, drawings: [{ id: 'line' }] },
    alerts: { version: 1, alerts: [{ id: 'fired', state: 'triggered' }] }, panes: [{ weight: 3 }, { weight: 1 }],
    viewport: { from: 1, to: 10 }, barSpacing: 12 };
  let state = structuredClone(original);
  const chart = { getState: () => structuredClone(state), primaryBars: () => [{ time: 100, close: 42 }],
    panes: () => [{}, {}], restoreState: vi.fn(next => { state = { ...state, ...structuredClone(next) }; return { applied: true, indicators: next.indicators.length }; }) };
  const target = { pane, chart, current: () => valid };
  const app = { chart: pane === 1 ? chart : {}, chart2: pane === 2 ? chart : null, activeIndicators: ['untouched'] };
  return { app, target, chart, original, get state() { return state; }, invalidate: () => { valid = false; } };
}

describe('reference indicator template actions', () => {
  it('captures detached styles, grouping and visibility without instance identities', () => {
    const h = setup(), captured = captureIndicatorTemplate(h.app, h.target);
    expect(captured[0]).toMatchObject({ indicatorId: 'ema', settings: { length: 9 }, visible: false, paneIndex: 0 });
    expect(captured[0]).not.toHaveProperty('instanceId'); captured[0].settings.length = 99;
    expect(h.state.indicators[0].settings.length).toBe(9);
  });

  it('applies only planned studies while retaining decorations and the primary scale', () => {
    const h = setup();
    applyIndicatorTemplate(h.app, h.target, [study({ indicatorId: 'rsi', paneIndex: 1 })], 'replace');
    const applied = h.chart.restoreState.mock.calls[0][0];
    expect(applied).toMatchObject({ drawings: h.original.drawings, alerts: h.original.alerts, panes: [h.original.panes[0]] });
    expect(applied).not.toHaveProperty('series'); expect(applied).not.toHaveProperty('viewport');
    expect(h.state.indicators[0]).not.toHaveProperty('instanceId');
    expect(h.app.activeIndicators).toEqual(h.state.indicators); expect(h.app.applyingTemplate).toBe(false);
  });

  it('keeps the primary mirror untouched when appending to the second chart', () => {
    const h = setup(2);
    applyIndicatorTemplate(h.app, h.target, [study({ indicatorId: 'rsi', paneIndex: 1 })], 'append');
    expect(h.app.activeIndicators).toEqual(['untouched']);
    expect(h.state.indicators.map(item => item.paneIndex)).toEqual([0, 2]);
    expect(h.state.indicators[0].instanceId).toBe('original');
    expect(h.chart.restoreState.mock.calls[0][0].panes).toEqual(h.original.panes);
  });

  it('rejects stale owners and missing custom descriptors before changing studies', () => {
    const h = setup();
    expect(() => applyIndicatorTemplate(h.app, h.target, [study({ indicatorId: 'missing' })], 'replace')).toThrow(/Missing/);
    h.invalidate();
    expect(() => captureIndicatorTemplate(h.app, h.target)).toThrow(/changed/);
    expect(() => applyIndicatorTemplate(h.app, h.target, [], 'replace')).toThrow(/changed/);
    expect(h.chart.restoreState).not.toHaveBeenCalled();
  });

  it('rolls back a partially applied restore and reports incomplete recovery', () => {
    const h = setup();
    h.chart.restoreState.mockReturnValueOnce({ applied: true, indicators: 0 });
    expect(() => applyIndicatorTemplate(h.app, h.target, [study()], 'replace')).toThrow(/all studies/);
    expect(h.chart.restoreState.mock.calls[1][0]).toMatchObject(h.original);
    expect(h.app.applyingTemplate).toBe(false);
    h.chart.restoreState.mockImplementationOnce(() => { throw new Error('Apply failed'); })
      .mockReturnValueOnce({ applied: false, reason: 'Recovery refused' });
    expect(() => applyIndicatorTemplate(h.app, h.target, [], 'replace')).toThrow(/recovery failed/);
    expect(h.app.applyingTemplate).toBe(false);
  });

  it('does not restore on empty append and permits changes to the active replay prefix', () => {
    const h = setup(); h.app.replay = {};
    expect(templateUnavailableReason(h.app, h.target)).toBeNull();
    applyIndicatorTemplate(h.app, h.target, [], 'append'); expect(h.chart.restoreState).not.toHaveBeenCalled();
    h.app.replayPicking = true;
    expect(() => applyIndicatorTemplate(h.app, h.target, [], 'replace')).toThrow(/replay/);
    h.app.replayPicking = false; h.app.loading = true;
    expect(() => captureIndicatorTemplate(h.app, h.target)).toThrow(/loading/);
  });
});
