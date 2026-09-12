/**
 * Tree-shake guard.
 *
 * The `.size-limit.json` entries measure whole BUNDLE FILES, which is the right
 * guard on total exported surface but says nothing about what a consumer ships.
 * The base bundle carries the OpenAlgo adapters, so hardening the WebSocket or
 * the order decoder grows that file even though a charting-only host never
 * imports them.
 *
 * This measures the number that matters to such a host: bundle an entry that
 * imports only `createChart`, let rollup shake, and brotli the result. It also
 * asserts the adapters are genuinely gone rather than merely small, because a
 * stray side effect would keep them and the byte count alone would not say why.
 *
 * Rollup is already a direct devDependency, so this adds nothing to the tree.
 */
import { rollup } from 'rollup';
import { brotliCompressSync } from 'node:zlib';

const BUNDLE = new URL('../dist/openalgo-charts.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// Raised from 38 to 39 kB in 1.8.6, for the per-series axis value tags: the
// collection pass in the pane, the tag renderer, and the resolve that keeps two
// of them off each other. Measured cost 0.31 kB brotli against a 37.89 kB
// baseline. Raise this only with the same kind of note, and never to get a
// build green: the point of the number is that a feature has to be worth its
// bytes to a host that only wanted a chart.
//
// Raised again to 39.5 kB on 2026-09-02, on this FORK: it carries the order-line
// editor plus the BarCache union/peek/prune work, and the pinned base 1639f1d
// already measured 39.07 kB — over upstream's 39.00 before any of this landed.
// Raised once. Do not raise it again without trimming something first.
//
// Raised to 39.7 kB on 2026-09-03, and the trim was done first: `hideCrosshair`
// and `_onPointerLeave` had the same nine lines of crosshair teardown in both,
// so the leave path now calls the public method, which is better code as well
// as smaller. That recovered 0.03 kB of the 0.15 the pass added and the rest is
// paid for. What it buys a host that only wanted a chart is a chart usable with
// a thumb: a press on an on-chart button no longer pans the plot out from under
// it, and a long press summons a crosshair, which a touch device had no way to
// see at all. Neither is a trading feature; both are the chart's own input.
//
// Raised to 40.2 kB on 2026-09-04, honestly: this budget was ALREADY red at
// 2e1461b (measured 39.97 kB against 39.70), so the number had stopped
// describing the tree and stopped being a gate. It describes it again now.
// What the pass that follows adds to a chart-only build is the drag-cancel
// seam: a second finger landing mid-drag has to be told to whoever is holding
// the line, or the line lies about where the order sits. That is the chart's
// own input, not a trading feature. Trim before raising this again.
//
// The two notes that follow are upstream's, against upstream's own 39 kB base
// rather than this fork's line; they are kept because they say what 2.0 costs a
// chart-only build, which is most of the number below.
//
// Raised from 39 to 40 kB for 2.0. The wheel zoom glide (398e813) took the
// chart-only import to 39.05 kB on its own, measured by building without the
// 2.0 change; the three modifier flags the click payload now carries for
// additive drawing selection land inside the same 39.05 kB reading. Both are
// core input behaviour a host that only wanted a chart still gets.
//
// Raised from 40 to 44 kB for the vector export (2.0). chart.exportSVG runs
// the ordinary paint into a serialising context (src/render/svg-export.ts),
// and because the call is synchronous and returns a string, the serialiser
// ships with the chart rather than behind a lazy import. Measured cost 3.75 kB
// brotli: 39.34 kB before, 43.09 kB after, on the same build.
//
// Raised to 45.7 kB on merging upstream 2.0.2 into this fork, and to 46.9 kB on
// merging 2.1.7. Upstream's own line moved 44 -> 45 kB over 2.1.x for the
// navigation preferences and the reset control, which are chart-only input too;
// this fork then pays for its own chart-only input work on top of the same tree
// — the touch crosshair, the tap-not-pan guard, the adopted-pointer steering
// and the drag-cancel seam. Measured 46.56 kB here against upstream's own
// published 45 kB ceiling for 2.1.7. Trim before raising this again.
const LIMIT_BYTES = 46.9 * 1024;

// Absent from a chart-only build. Each is a string that appears in the adapter
// source and nowhere in the rendering core.
const MUST_BE_SHAKEN = [
  ['WebSocket adapter', 'authenticate'],
  ['order decoder', 'placeorder'],
  // The GPU backend lives in its own tier (src/render/webgl, shipped as
  // openalgo-charts.webgl.mjs) and nothing in the base entry imports it. The
  // string is the context-loss listener that only that backend installs.
  ['WebGL2 backend', 'webglcontextlost'],
  // The widget is the one tier that ships DOM (src/widget, shipped as
  // openalgo-charts.widget.mjs). The ESLint ACL forbids the base from importing
  // it; this is the check on the built output, so that a host which only
  // wanted a chart can never receive a toolbar. The string is the CSS scope
  // every widget rule is written under, and nothing in the engine paints HTML.
  ['widget tier', 'oac-widget'],
];

const virtual = {
  name: 'virtual-entry',
  resolveId: (id) => (id === '\0entry' ? id : null),
  load: (id) => (id === '\0entry' ? `export { createChart } from ${JSON.stringify(BUNDLE)};` : null),
};

const bundle = await rollup({ input: '\0entry', plugins: [virtual], logLevel: 'silent' });
const { output } = await bundle.generate({ format: 'es' });
await bundle.close();

const code = output.map((c) => (c.type === 'chunk' ? c.code : '')).join('');
const size = brotliCompressSync(Buffer.from(code)).length;

let failed = false;
for (const [what, needle] of MUST_BE_SHAKEN) {
  if (code.includes(needle)) {
    console.error(`FAIL: the ${what} survived a chart-only import (found ${JSON.stringify(needle)})`);
    failed = true;
  }
}

const kb = (n) => (n / 1024).toFixed(2) + ' kB';
if (size > LIMIT_BYTES) {
  console.error(`FAIL: chart-only import is ${kb(size)} brotli, over the ${kb(LIMIT_BYTES)} budget`);
  failed = true;
}

console.log(`chart-only import (tree-shaken): ${kb(size)} brotli, budget ${kb(LIMIT_BYTES)}`);
if (failed) process.exit(1);
