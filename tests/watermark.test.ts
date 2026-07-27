import { describe, it, expect } from 'vitest';
import { LogoWatermark, watermarkRect } from '../src/primitives/watermark';
import type { PrimitiveRenderContext } from '../src/primitives/primitive';
import { makeCtx } from './helpers/fake-ctx';
import { PriceScale } from '../src/scale/price-scale';
import { TimeScale } from '../src/scale/time-scale';
import { DataLayer } from '../src/model/data-layer';
import { darkTheme } from '../src/theme';

describe('watermarkRect', () => {
  it('anchors to each corner and center', () => {
    const plotW = 800, plotH = 400, m = 10, w = 40, h = 20;
    expect(watermarkRect('top-left', m, w, h, plotW, plotH)).toMatchObject({ x: 10, y: 10 });
    expect(watermarkRect('top-right', m, w, h, plotW, plotH)).toMatchObject({ x: 750, y: 10 });
    expect(watermarkRect('bottom-left', m, w, h, plotW, plotH)).toMatchObject({ x: 10, y: 370 });
    expect(watermarkRect('bottom-right', m, w, h, plotW, plotH)).toMatchObject({ x: 750, y: 370 });
    expect(watermarkRect('center', m, w, h, plotW, plotH)).toMatchObject({ x: 380, y: 190 });
  });
});

describe('LogoWatermark', () => {
  const fakeImage = { width: 100, height: 50 } as unknown as CanvasImageSource & { width: number; height: number };

  function recorder() {
    const calls: Array<{ args: unknown[] }> = [];
    const ctx = {
      canvas: { ownerDocument: undefined },
      globalAlpha: 1,
      save() {}, restore() {},
      drawImage(...args: unknown[]) { calls.push({ args }); },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  const rc = (dpr: number): PrimitiveRenderContext => ({
    plotWidth: 600, plotHeight: 300, priceAxisWidth: 0, dpr,
    // scales/dataLayer/theme are unused by the watermark
  } as unknown as PrimitiveRenderContext);

  it('draws a preloaded image at the bottom-right, scaled by dpr', () => {
    const wm = new LogoWatermark({ image: fakeImage, position: 'bottom-right', margin: 12, height: 30, opacity: 0.5 });
    const { ctx, calls } = recorder();
    wm.draw(ctx, rc(2));
    expect(calls).toHaveLength(1);
    // aspect 100/50 = 2 -> w = 60, h = 30; device px = *2
    const [img, dx, dy, dw, dh] = calls[0].args as [unknown, number, number, number, number];
    expect(img).toBe(fakeImage);
    expect(dw).toBe(120); // 60 * 2
    expect(dh).toBe(60);  // 30 * 2
    // bottom-right: x = 600 - 12 - 60 = 528 -> *2 = 1056 ; y = 300 - 12 - 30 = 258 -> *2 = 516
    expect(dx).toBe(1056);
    expect(dy).toBe(516);
  });

  it('does nothing until an image is ready', () => {
    const wm = new LogoWatermark({ src: 'about:blank' });
    const { ctx, calls } = recorder();
    wm.draw(ctx, rc(1));
    expect(calls).toHaveLength(0);
  });
});

describe('hover-revealed label', () => {
  const rc = (hoverId: string | null = null): PrimitiveRenderContext => ({
    timeScale: new TimeScale(), priceScale: new PriceScale(), dataLayer: new DataLayer(),
    plotWidth: 600, plotHeight: 400, priceAxisWidth: 56, dpr: 1, theme: darkTheme, hoverId,
  });
  const img = { width: 40, height: 20, naturalWidth: 40, naturalHeight: 20 } as never;

  it('does not hit-test at all without a label', () => {
    const w = new LogoWatermark({ image: img, position: 'bottom-left', margin: 10, height: 20 });
    w.draw(makeCtx().ctx, rc());
    // A plain mark is decoration; it must not swallow clicks meant for the chart.
    expect(w.hitTest(20, 375, rc())).toBeNull();
  });

  it('hit-tests the mark once it has a label to reveal', () => {
    const w = new LogoWatermark({ image: img, position: 'bottom-left', margin: 10, height: 20, label: 'OpenAlgo Charts' });
    w.draw(makeCtx().ctx, rc());
    expect(w.hitTest(20, 375, rc())?.externalId).toBe('watermark');
    expect(w.hitTest(500, 100, rc())).toBeNull();
  });

  it('draws no label at rest and text once hovered', () => {
    const w = new LogoWatermark({
      image: img, position: 'bottom-left', margin: 10, height: 20,
      label: 'OpenAlgo Charts', revealSeconds: 0,
    });
    const cold = makeCtx();
    w.draw(cold.ctx, rc());
    expect(cold.rec.ops.filter((o) => o.type === 'fillText')).toHaveLength(0);

    const hot = makeCtx();
    w.draw(hot.ctx, rc('watermark'));
    expect(hot.rec.ops.filter((o) => o.type === 'fillText')).toHaveLength(1);
  });

  it('eases rather than snapping, and asks for frames while moving', () => {
    let updates = 0;
    const w = new LogoWatermark({
      image: img, position: 'bottom-left', margin: 10, height: 20,
      label: 'OpenAlgo Charts', revealSeconds: 0.2,
    });
    w.attached({ requestUpdate: () => { updates += 1; } } as never);
    // Two frames in: still mid-reveal, so it must keep requesting frames.
    w.draw(makeCtx().ctx, rc('watermark'));
    w.draw(makeCtx().ctx, rc('watermark'));
    expect(updates).toBeGreaterThan(0);
  });
});

describe('link attribution', () => {
  const img = { width: 40, height: 20, naturalWidth: 40, naturalHeight: 20 } as never;

  it('appends utm parameters naming the embedding page', () => {
    const w = new LogoWatermark({ image: img, href: 'https://openalgo.in' });
    const href = w.href() as string;
    expect(href.startsWith('https://openalgo.in?')).toBe(true);
    expect(href).toContain('utm_medium=oac-link');
    expect(href).toContain('utm_campaign=oac-chart');
  });

  it('leaves a caller-composed query string alone', () => {
    const w = new LogoWatermark({ image: img, href: 'https://openalgo.in/?ref=mine' });
    expect(w.href()).toBe('https://openalgo.in/?ref=mine');
  });

  it('is not clickable without an href', () => {
    const w = new LogoWatermark({ image: img });
    expect(w.href()).toBeUndefined();
  });

  it('reports a pointer cursor only when it links somewhere', () => {
    const rc = {
      timeScale: new TimeScale(), priceScale: new PriceScale(), dataLayer: new DataLayer(),
      plotWidth: 600, plotHeight: 400, priceAxisWidth: 56, dpr: 1, theme: darkTheme, hoverId: null,
    } as PrimitiveRenderContext;
    const plain = new LogoWatermark({ image: img, position: 'bottom-left', margin: 10, height: 20, label: 'X' });
    const linked = new LogoWatermark({ image: img, position: 'bottom-left', margin: 10, height: 20, label: 'X', href: 'https://openalgo.in' });
    plain.draw(makeCtx().ctx, rc);
    linked.draw(makeCtx().ctx, rc);
    expect(plain.hitTest(20, 375, rc)?.cursor).toBe('default');
    expect(linked.hitTest(20, 375, rc)?.cursor).toBe('pointer');
  });
});
