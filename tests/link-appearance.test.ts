import { describe, expect, it } from 'vitest';
import { LinkGroup } from '../src/link/group';
import type { LinkChart, LinkMemberOptions } from '../src/link/group';
import { DataLayer } from '../src/model/data-layer';
import { filterLinkAppearance } from '../src/link/appearance';

function host() {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const chart: LinkChart & { emit(event: string): void } = {
    on(event, cb) {
      const set = listeners.get(event) ?? new Set();
      set.add(cb); listeners.set(event, set);
      return () => { set.delete(cb); };
    },
    emit(event) { for (const cb of listeners.get(event) ?? []) cb(undefined); },
    panes: () => [{}], dataLayer: new DataLayer(),
    getVisibleLogicalRange: () => ({ from: 0, to: 1 }), setVisibleLogicalRange() {},
    addPrimitive() {}, removePrimitive() {},
  };
  let values = { 'canvas.grid.vertColor': '#123456', 'symbol.upColor': '#008800' } as Record<string, string | boolean | number>;
  let applies = 0;
  const appearance = {
    read: () => values,
    apply(next: Readonly<Record<string, string | boolean | number>>) {
      values = { ...values, ...next }; applies++; chart.emit('style:change');
    },
  };
  return { chart, appearance, values: () => values, applies: () => applies };
}

describe('appearance linking', () => {
  it('retains the existing readout visibility fields', () => {
    const values = Object.fromEntries(['logo', 'marketStatus', 'chartValues', 'barChange', 'lastDayChange', 'lastValueLabel']
      .map(key => [`statusLine.${key}`, false]));
    expect(filterLinkAppearance(values)).toEqual(values);
  });
  it('is opt-in and copies visual settings without echo or semantic state', () => {
    const a = host(); const b = host(); const c = host();
    const group = new LinkGroup();
    for (const member of [a, b, c]) group.add(member.chart, { appearance: member.appearance } as LinkMemberOptions);
    Object.assign(a.values(), { 'canvas.grid.vertColor': '#abcdef', symbol: 'OTHER', interval: '1h',
      'trading.orderColor': '#ff0000', 'time.timezone': 'UTC', 'navigation.mousePan': 'horizontal',
      'events.visible': false, 'symbol.instrument': 'OTHER', 'watermark.text': 'SOURCE' });
    a.chart.emit('style:change');
    expect(b.values()['canvas.grid.vertColor']).toBe('#123456');
    group.setOptions({ appearance: true });
    a.chart.emit('style:change');
    expect(b.values()).toEqual({ 'canvas.grid.vertColor': '#abcdef', 'symbol.upColor': '#008800' });
    expect(c.values()).toEqual(b.values());
    expect([a.applies(), b.applies(), c.applies()]).toEqual([0, 1, 1]);
  });

  it('supports explicit notifications, fresh copies, removal and disposal', () => {
    const a = host(); const b = host();
    const group = new LinkGroup({ appearance: true });
    group.add(a.chart, { appearance: a.appearance });
    group.add(b.chart, { appearance: b.appearance });
    a.values()['symbol.upColor'] = '#112233';
    group.syncAppearance(a.chart);
    expect(b.values()['symbol.upColor']).toBe('#112233');
    b.values()['symbol.upColor'] = '#ffffff';
    expect(a.values()['symbol.upColor']).toBe('#112233');
    group.remove(b.chart); group.syncAppearance(a.chart);
    expect(b.applies()).toBe(1);
    group.destroy(); group.syncAppearance(a.chart);
    expect(b.applies()).toBe(1);
  });
});
