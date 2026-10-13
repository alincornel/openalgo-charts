/**
 * A tooltip never takes the pointer.
 *
 * The overlay layer turns pointer events back on for everything mounted in
 * it, and that rule came after the tooltip's own `pointer-events: none` at
 * the same specificity, so it won. A tooltip shown over a control swallowed
 * the click meant for that control: in a browser, the bottom bar's range tip
 * sat over the folded rail's tab and the tab could not be pressed.
 *
 * Asserted against the stylesheet by applying, in source order, every rule
 * that can reach a tooltip in the layer: the specificities tie, so the last
 * one standing is the one a browser uses.
 */
import { describe, expect, it } from 'vitest';
import { WIDGET_CSS } from '../src/widget/styles';

/** Whether a selector reaches a tooltip mounted in the overlay layer. */
function reachesTip(selector: string): boolean {
  const not = /\.oac-layer > :not\(([^)]*)\)$/.exec(selector);
  if (not !== null) return !not[1]!.split(',').some((s) => s.trim() === '.oac-tip');
  if (/\.oac-layer > \*$/.test(selector)) return true;
  return /\.oac-tip(?![-_a-z])/.test(selector);
}

/** The pointer-events a tooltip in the overlay layer ends up with. */
function tipPointerEvents(css: string): string | null {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let value: string | null = null;
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const pe = /pointer-events:\s*([a-z]+)/.exec(m[2]!);
    if (pe === null) continue;
    if (m[1]!.split(/,(?![^(]*\))/).map((x) => x.trim()).some(reachesTip)) value = pe[1]!;
  }
  return value;
}

describe('tooltips in the overlay layer', () => {
  it('leave the press to the control under them', () => {
    expect(tipPointerEvents(WIDGET_CSS)).toBe('none');
  });
});
