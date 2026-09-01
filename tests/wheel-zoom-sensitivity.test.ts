import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart, type ChartOptions } from '../src/core/chart';
import { makeCtx } from './helpers/fake-ctx';

function fakeDoc(): Document {
  const make = (tag: string): Record<string, unknown> => {
    const el: Record<string, unknown> = {
      tagName: tag.toUpperCase(), style: {}, children: [],
      appendChild(c: unknown) { (el.children as unknown[]).push(c); return c; },
      remove() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      addEventListener() {}, removeEventListener() {},
      setAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    };
    if (tag === 'canvas') {
      el.width = 0; el.height = 0;
      el.getContext = () => makeCtx().ctx;
    }
    return el;
  };
  return { createElement: (tag: string) => make(tag) } as unknown as Document;
}

function mount(options: Pick<ChartOptions, 'wheelZoomSensitivity'> = {}) {
  const doc = fakeDoc();
  const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const el: Record<string, unknown> = {
    ownerDocument: doc,
    style: {} as Record<string, string>,
    children: [] as unknown[],
    clientWidth: 800, clientHeight: 600, tabIndex: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getAttribute: () => null, setAttribute() {}, hasAttribute: () => false,
    contains: () => false,
    appendChild(c: unknown) { (el.children as unknown[]).push(c); return c; },
    remove() {},
    addEventListener(type: string, fn: (event: Record<string, unknown>) => void) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(fn);
      listeners.set(type, handlers);
    },
    removeEventListener() {},
  };
  const chart = new Chart(el as unknown as HTMLElement, {
    ...options,
    document: doc,
    pixelRatio: () => 1,
    raf: { schedule: (cb) => { cb(); return 1; }, cancel: () => {} },
  });
  chart.addSeries('candlestick').setData([
    { time: 1000, open: 10, high: 12, low: 8, close: 11 },
    { time: 1060, open: 11, high: 13, low: 9, close: 12 },
  ]);
  // Two bars auto-fit at the maximum spacing; move away from the clamp so the
  // test measures the wheel factor rather than the fit-content ceiling.
  chart.timeScale.setBarSpacing(8);

  const wheel = (deltaY: number) => {
    const preventDefault = vi.fn();
    for (const handler of listeners.get('wheel') ?? []) {
      handler({ clientX: 400, clientY: 300, deltaY, preventDefault });
    }
    return preventDefault;
  };
  return { chart, wheel };
}

describe('ChartOptions.wheelZoomSensitivity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the shipped 1.1x wheel step by default', () => {
    vi.stubGlobal('window', {});
    const { chart, wheel } = mount();
    const before = chart.timeScale.barSpacing;

    expect(wheel(-1)).toHaveBeenCalledOnce();
    expect(chart.timeScale.barSpacing / before).toBeCloseTo(1.1, 8);
  });

  it('damps every event in a trackpad-style burst', () => {
    vi.stubGlobal('window', {});
    const { chart, wheel } = mount({ wheelZoomSensitivity: 0.25 });
    const before = chart.timeScale.barSpacing;

    for (let i = 0; i < 8; i++) wheel(-1);

    expect(chart.timeScale.barSpacing / before).toBeCloseTo(Math.pow(1.1, 2), 8);
  });

  it('allows wheel zoom to be disabled without releasing page-scroll trapping', () => {
    vi.stubGlobal('window', {});
    const { chart, wheel } = mount({ wheelZoomSensitivity: 0 });
    const before = chart.timeScale.barSpacing;

    expect(wheel(-1)).toHaveBeenCalledOnce();
    expect(chart.timeScale.barSpacing).toBe(before);
  });
});
