import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as engine from '../src/index';
import * as widget from '../src/widget/index';
import type { AlertSource, ContextMenuEvent } from '../src/index';
import type { Widget } from '../src/widget/index';
import { ensureWindowGlobal, fakeContainer, fakeWidgetDocument, fire, type FakeElement } from './helpers/fake-dom-widget';

beforeAll(ensureWindowGlobal);
engine.registerIndicator({
  id: 'widget-alert-study', name: 'Alert study', placement: 'pane', inputs: [],
  plots: [{ key: 'close', title: 'Close reading', type: 'line' }, { key: 'oi', title: 'Open interest', type: 'line' }],
  calc: bars => ({ close: bars.map(bar => bar.close), oi: bars.map(bar => bar.oi ?? null) }),
});
const live: Widget[] = [];
afterEach(() => { for (const w of live.splice(0)) w.destroy(); vi.useRealTimers(); });

function make(options: widget.WidgetOptions = {}): { w: Widget; root: FakeElement } {
  const doc = fakeWidgetDocument();
  const w = widget.createWidget(fakeContainer(doc) as unknown as HTMLElement, {
    document: doc as unknown as Document, persist: false, pixelRatio: () => 1,
    raf: { schedule: cb => { cb(); return 1; }, cancel: () => {} },
    ...options,
  });
  live.push(w);
  w.chart.applySize(800, 600);
  w.series.setData([{ time: 1000, open: 100, high: 101, low: 99, close: 100 }]);
  const root = w.root as unknown as FakeElement;
  root.rect = { left: 0, top: 0, width: 800, height: 600 };
  root.offsetWidth = 800; root.offsetHeight = 600;
  return { w, root };
}

function field(root: FakeElement, key: string): FakeElement {
  const row = root.querySelector(`[data-key="${key}"]`)!;
  expect(row, `Missing field ${key}`).not.toBeNull();
  return row.querySelector('input') ?? row.querySelector('select') ?? row.querySelector('textarea')!;
}
function change(root: FakeElement, key: string, value: string | boolean): void {
  const input = field(root, key);
  if (typeof value === 'boolean') input.checked = value;
  else input.value = value;
  fire(input, 'change');
}
function click(root: FakeElement, action: string): void {
  const target = root.querySelector(`[data-action="${action}"]`)!;
  expect(target, `Missing action ${action}`).not.toBeNull();
  fire(target, 'click');
}

describe('alert settings schema', () => {
  it('offers only conditions evaluable for each source and exposes range bounds', () => {
    const conditions = (source: AlertSource) => {
      const input = engine.alertSettingsSchema(source).find(input => input.key === 'condition');
      return input?.type === 'select' ? input.options.map(option => option.value) : [];
    };
    expect(conditions({ kind: 'barCondition', id: 'bullish' })).toEqual(['matches']);
    expect(conditions({ kind: 'drawing', drawingId: 'channel', level: 'band' }))
      .toEqual(['enteringRange', 'leavingRange']);
    expect(conditions({ kind: 'drawing', drawingId: 'line' }))
      .toEqual(['crossing', 'crossingUp', 'crossingDown', 'greaterThan', 'lessThan']);
    expect(engine.alertSettingsSchema({ kind: 'price', price: 0 }, 'enteringRange').map(input => input.key))
      .toEqual(expect.arrayContaining(['price', 'upperPrice', 'policy', 'repeat', 'cooldownSeconds', 'expiresAt', 'enabled']));
  });
});

describe('widget alert editor', () => {
  it('keeps keyboard focus on a selector when its dependent fields change', () => {
    const { w, root } = make();
    widget.mountAlertEditor(w.context);
    field(root, 'condition').focus();
    change(root, 'condition', 'enteringRange');
    expect(w.context.document.activeElement).toBe(field(root, 'condition'));
    expect(field(root, 'upperPrice')).not.toBeNull();
  });
  it('selects a particular study instance and plot without converting an absent value to zero', () => {
    const { w, root } = make();
    w.chart.addIndicator('widget-alert-study');
    const second = w.chart.addIndicator('widget-alert-study');
    widget.mountAlertEditor(w.context);
    change(root, 'kind', 'indicator');
    change(root, 'instanceId', second.id);
    change(root, 'plotKey', 'oi');
    expect(field(root, 'value').value).toBe('');
    expect(root.textContent).toContain('unavailable');
    change(root, 'value', '0');
    click(root, 'save-alert');
    expect(w.alerts.list()).toMatchObject([{ source: { kind: 'indicator', instanceId: second.id, plotKey: 'oi', value: 0 } }]);
    expect(w.alerts.availability(w.alerts.list()[0].id).available).toBe(false);
  });

  it('offers registered candle predicates and stores their identity', () => {
    const { w, root } = make();
    widget.mountAlertEditor(w.context);
    change(root, 'kind', 'barCondition');
    change(root, 'barConditionId', 'outside');
    click(root, 'save-alert');
    expect(w.alerts.list()).toMatchObject([{ source: { kind: 'barCondition', id: 'outside' }, condition: 'matches' }]);
  });

  it('requires a compatible input plot for a study-pane drawing and stores its explicit level', () => {
    const { w, root } = make();
    const study = w.chart.addIndicator('widget-alert-study');
    const drawing = w.draw.add({ tool: 'horizontal-line', paneIndex: study.paneIndex, style: {}, points: [{ time: 1000, price: 105 }] });
    widget.mountAlertEditor(w.context, undefined, { source: { kind: 'drawing', drawingId: drawing.id } });
    expect(field(root, 'inputInstanceId').value).toBe(study.id);
    change(root, 'inputPlotKey', 'close');
    click(root, 'save-alert');
    expect(w.alerts.list()).toMatchObject([{ source: {
      kind: 'drawing', drawingId: drawing.id, level: 'line', input: { instanceId: study.id, plotKey: 'close' },
    } }]);
  });

  it('changes a channel band to a line condition when selecting a boundary', () => {
    const { w, root } = make();
    const drawing = w.draw.add({ tool: 'parallel-channel', paneIndex: 0, style: {},
      points: [{ time: 900, price: 90 }, { time: 1100, price: 100 }, { time: 1000, price: 110 }] });
    widget.mountAlertEditor(w.context, undefined, { source: { kind: 'drawing', drawingId: drawing.id, level: 'band' } });
    expect(field(root, 'condition').value).toBe('enteringRange');
    change(root, 'level', 'base');
    expect(field(root, 'condition').value).toBe('crossing');
    click(root, 'save-alert');
    expect(w.alerts.list()[0]).toMatchObject({ condition: 'crossing', source: { level: 'base' } });
  });

  it('disables unsupported or removed drawing anchors with an explanation', () => {
    const { w, root } = make();
    const unsupported = w.draw.add({ tool: 'rectangle', paneIndex: 0, style: {}, points: [{ time: 900, price: 90 }, { time: 1100, price: 100 }] });
    const editor = widget.mountAlertEditor(w.context, undefined, { source: { kind: 'drawing', drawingId: unsupported.id } });
    expect(root.querySelector('[data-action="save-alert"]')!.disabled).toBe(true);
    expect(root.querySelector('.oac-alert-error')!.textContent).toContain('numeric');
    editor.close();
    const drawing = w.draw.add({ tool: 'horizontal-line', paneIndex: 0, style: {}, points: [{ time: 1000, price: 105 }] });
    widget.mountAlertEditor(w.context, undefined, { source: { kind: 'drawing', drawingId: drawing.id } });
    w.draw.remove(drawing.id);
    expect(root.querySelector('[data-action="save-alert"]')!.disabled).toBe(true);
    click(root, 'save-alert');
    expect(w.alerts.list()).toEqual([]);
  });

  it('owns the evaluator and saves a draft only after explicit confirmation', () => {
    const { w, root } = make();
    expect(w.alerts).toBeInstanceOf(engine.AlertController);
    expect(w.context.alerts).toBe(w.alerts);
    const editor = widget.mountAlertEditor(w.context, undefined, { source: { kind: 'price', price: 105 } });
    expect(root.textContent).toContain('Bar close');
    expect(root.textContent).toContain('final history');
    change(root, 'title', 'My threshold');
    expect(w.alerts.list()).toEqual([]);
    click(root, 'save-alert');
    expect(editor.isOpen()).toBe(false);
    expect(w.alerts.list()).toMatchObject([{ title: 'My threshold', source: { kind: 'price', price: 105 }, policy: 'onBarClose', repeat: 'once' }]);
    expect(w.getState().chart.alerts?.alerts).toHaveLength(1);
  });

  it('cancels without creating an alert or changing an existing alert', () => {
    const { w, root } = make();
    widget.mountAlertEditor(w.context);
    click(root, 'cancel-alert');
    expect(w.alerts.list()).toEqual([]);
    const alert = w.alerts.add({ source: { kind: 'price', price: 105 }, title: 'Original' });
    const editor = widget.mountAlertEditor(w.context, undefined, { alertId: alert.id });
    change(root, 'title', 'Draft');
    editor.close();
    expect(w.alerts.list()[0].title).toBe('Original');
  });

  it('accepts zero bounds, explicit touch timing, cooldown and a UTC expiry', () => {
    const { w, root } = make();
    widget.mountAlertEditor(w.context, undefined, { source: { kind: 'price', price: 0 } });
    change(root, 'condition', 'enteringRange');
    change(root, 'upperPrice', '10');
    change(root, 'policy', 'onTouch');
    change(root, 'repeat', 'everyTime');
    change(root, 'cooldownSeconds', '45');
    change(root, 'expiresAt', '2099-01-02T03:04');
    change(root, 'enabled', false);
    click(root, 'save-alert');
    expect(w.alerts.list()).toMatchObject([{
      source: { kind: 'price', price: 0, upperPrice: 10 }, condition: 'enteringRange',
      policy: 'onTouch', repeat: 'everyTime', cooldownSeconds: 45, state: 'disabled',
      expiresAt: Date.parse('2099-01-02T03:04:00Z') / 1000,
    }]);
  });

  it('rejects an empty threshold instead of retaining a stale numeric draft', () => {
    const { w, root } = make();
    const editor = widget.mountAlertEditor(w.context, undefined, { source: { kind: 'price', price: 105 } });
    field(root, 'price').value = '';
    fire(field(root, 'price'), 'change');
    click(root, 'save-alert');
    expect(editor.isOpen()).toBe(true);
    expect(w.alerts.list()).toEqual([]);
    expect(root.querySelector('.oac-alert-error')!.textContent).not.toBe('');
  });

  it('preserves a triggered once alert when editing its title, then enables it deliberately', () => {
    const { w, root } = make();
    const alert = w.alerts.add({ source: { kind: 'price', price: 105 }, policy: 'onTouch', title: 'Threshold' });
    w.series.update({ time: 1000, open: 100, high: 110, low: 99, close: 110 });
    expect(w.alerts.list()[0].state).toBe('triggered');
    expect(root.querySelector('.oac-toast__msg')!.textContent).toContain('Threshold');
    widget.mountAlertEditor(w.context, undefined, { alertId: alert.id });
    change(root, 'title', 'Already fired');
    click(root, 'save-alert');
    expect(w.alerts.list()[0]).toMatchObject({ state: 'triggered', title: 'Already fired', lastTriggeredTime: 1000 });
    widget.mountAlertEditor(w.context, undefined, { alertId: alert.id });
    change(root, 'enabled', true);
    click(root, 'save-alert');
    expect(w.alerts.list()[0].state).toBe('armed');
  });

  it('prevents a draft from being silently retargeted after an instrument change', () => {
    const { w, root } = make();
    const editor = widget.mountAlertEditor(w.context, undefined, { source: { kind: 'price', price: 105 } });
    w.setSymbol('NEW', 'NSE');
    click(root, 'save-alert');
    expect(editor.isOpen()).toBe(true);
    expect(w.alerts.list()).toEqual([]);
    expect(root.querySelector('.oac-alert-error')!.textContent).toContain('context');
  });

  it('preserves an existing expiry instant when another field is edited', () => {
    const { w, root } = make();
    const expiresAt = Date.parse('2099-01-02T03:04:25Z') / 1000 + 0.5;
    const alert = w.alerts.add({ source: { kind: 'price', price: 105 }, expiresAt });
    widget.mountAlertEditor(w.context, undefined, { alertId: alert.id });
    change(root, 'title', 'Rename only');
    click(root, 'save-alert');
    expect(w.alerts.list()[0].expiresAt).toBe(expiresAt);
  });

  it('keeps labels bound to the correct editor when two drafts are open', () => {
    const { w } = make();
    const one = widget.mountAlertEditor(w.context);
    const two = widget.mountAlertEditor(w.context);
    const first = field(one.el as unknown as FakeElement, 'price');
    const second = field(two.el as unknown as FakeElement, 'price');
    expect(first.id).not.toBe(second.id);
    one.close(); two.close();
  });
});

describe('widget alert list', () => {
  it('saves a consumed touch even when cooldown suppresses its delivery', () => {
    vi.useFakeTimers();
    const store = new Map<string, string>();
    const { w } = make({ persist: true, storage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value); }, removeItem: key => { store.delete(key); },
    } });
    w.alerts.add({ source: { kind: 'price', price: 105 }, condition: 'greaterThan', policy: 'onTouch', repeat: 'everyTime', cooldownSeconds: 60 });
    w.series.update({ time: 1000, open: 100, high: 110, low: 99, close: 110 });
    vi.advanceTimersByTime(300);
    w.series.update({ time: 1060, open: 110, high: 111, low: 110, close: 111 });
    vi.advanceTimersByTime(300);
    const saved = w.context.storage.get(widget.STATE_KEY) as widget.WidgetState;
    expect(saved.chart.alerts?.alerts[0]).toMatchObject({ lastTriggeredTime: 1000, lastTouchedTime: 1060 });
  });
  it('updates and saves an expiry on an idle feed', () => {
    vi.useFakeTimers();
    const store = new Map<string, string>();
    const { w, root } = make({ persist: true, storage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value); }, removeItem: key => { store.delete(key); },
    } });
    const record = w.alerts.add({ source: { kind: 'price', price: 105 }, expiresAt: Date.now() / 1000 + 1 });
    w.openAlerts();
    vi.advanceTimersByTime(1300);
    const row = root.querySelector(`[data-alert-id="${record.id}"]`)!;
    expect(row.textContent).toContain('Expired');
    const saved = w.context.storage.get(widget.STATE_KEY) as widget.WidgetState;
    expect(saved.chart.alerts?.alerts[0].state).toBe('expired');
    expect(row.querySelector('[data-action="toggle-alert"]')!.disabled).toBe(true);
    expect(row.querySelector('[data-action="toggle-alert"]')!.title).toContain('expiry');
  });
  it('opens from desktop and mobile controls and reflects enable, disable and delete immediately', () => {
    const { w, root } = make();
    const record = w.alerts.add({ title: 'Visible alert', source: { kind: 'price', price: 105 } });
    const opener = root.querySelector('.oac-topbar__alerts');
    expect(opener).not.toBeNull();
    fire(opener!, 'click');
    let row = root.querySelector(`[data-alert-id="${record.id}"]`)!;
    expect(row.textContent).toContain('Armed');
    click(row, 'toggle-alert');
    expect(w.alerts.list()[0].state).toBe('disabled');
    row = root.querySelector(`[data-alert-id="${record.id}"]`)!;
    expect(row.textContent).toContain('Disabled');
    click(row, 'toggle-alert');
    expect(w.alerts.list()[0].state).toBe('armed');
    click(row, 'delete-alert');
    expect(w.alerts.list()).toEqual([]);
    expect(root.querySelector('.oac-alerts')!.textContent).toContain('No alerts');
    w.context.overlays.closeAll();
    const more = root.querySelector('[data-mobile-action="more"]')!;
    fire(more, 'click');
    fire(root.querySelector('[data-mobile-action="alerts"]')!, 'click');
    expect(root.querySelector('.oac-alerts')).not.toBeNull();
    w.destroy();
    expect(w.openAlerts()).toBe(false);
  });

  it('keeps a triggered once record visible after a widget state restore without a new notification', () => {
    const { w, root } = make();
    w.alerts.add({ title: 'Fired alert', source: { kind: 'price', price: 105 }, policy: 'onTouch' });
    w.series.update({ time: 1000, open: 100, high: 110, low: 99, close: 110 });
    const state = w.getState();
    const restored = make();
    restored.w.restoreState(state);
    expect(restored.root.querySelector('.oac-toast__msg')).toBeNull();
    expect(restored.w.openAlerts()).toBe(true);
    expect(restored.root.querySelector('.oac-alerts')!.textContent).toContain('Triggered');
    expect(restored.root.querySelector('.oac-alerts')!.textContent).toContain('Fired alert');
    expect(root.querySelector('.oac-toast__msg')).not.toBeNull();
  });

  it('reports a nonportable host payload without aborting widget teardown', () => {
    const store = new Map<string, string>();
    const { w } = make({ persist: true, storage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { store.set(key, value); }, removeItem: key => { store.delete(key); },
    } });
    const errors: string[] = [];
    w.on('status', event => { if (event.kind === 'error') errors.push(event.text); });
    w.alerts.add({ source: { kind: 'price', price: 105 }, payload: { callback: () => {} } });
    expect(() => w.destroy()).not.toThrow();
    expect(w.isDestroyed).toBe(true);
    expect(errors.join(' ')).toContain('saved');
    expect(w.alerts.list()).toEqual([]);
  });
});

describe('alert context actions', () => {
  it('seeds the clicked plot and bar reading instead of the first plot or latest bar', () => {
    const { w, root } = make();
    w.series.setData([{ time: 1000, open: 100, high: 101, low: 99, close: 100, oi: 0 },
      { time: 1060, open: 110, high: 111, low: 109, close: 110, oi: 20 }]);
    const study = w.chart.addIndicator('widget-alert-study');
    const event: ContextMenuEvent = { paneIndex: study.paneIndex, point: { x: 150, y: 80 },
      price: 0, time: 1000, index: 0,
      target: { kind: 'indicator', id: `indicator:${study.id}`, instanceId: study.id, plotKey: 'oi' },
      preventDefault: () => {} };
    const action = widget.contextMenuEntries(w.context, event)
      .find(entry => 'id' in entry && entry.id === 'alert-indicator') as widget.MenuItem;
    action.run!();
    expect(field(root, 'plotKey').value).toBe('oi');
    expect(field(root, 'value').value).toBe('0');
  });

  it('seeds a price or drawing alert from its actual target, and keeps study-pane units separate', () => {
    const { w, root } = make();
    const event: ContextMenuEvent = { paneIndex: 0, point: { x: 150, y: 80 }, price: 107, time: 1000, index: 0,
      target: { kind: 'empty', id: null }, preventDefault: () => {} };
    const menu = widget.contextMenuEntries(w.context, event);
    const action = menu.find(entry => entry.kind !== 'separator' && entry.kind !== 'header' && entry.id === 'alert-create') as widget.MenuItem;
    expect(action).toBeDefined();
    action.run!();
    expect(field(root, 'price').value).toBe('107');
    w.context.overlays.closeAll();
    expect(widget.contextMenuEntries(w.context, { ...event, paneIndex: 1 }).some(entry => 'id' in entry && entry.id === 'alert-create')).toBe(false);
    const line = w.draw.add({ tool: 'horizontal-line', paneIndex: 0, style: {}, points: [{ time: 1000, price: 109 }] });
    const drawingMenu = widget.contextMenuEntries(w.context, { ...event, target: { kind: 'drawing', id: `draw:${line.id}` } });
    const drawingAction = drawingMenu.find(entry => 'id' in entry && entry.id === 'alert-drawing') as widget.MenuItem;
    expect(drawingAction).toBeDefined();
    drawingAction.run!();
    click(root, 'save-alert');
    expect(w.alerts.list()[0].source).toMatchObject({ kind: 'drawing', drawingId: line.id, level: 'line' });
  });
});
