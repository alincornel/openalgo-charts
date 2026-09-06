# OpenAlgo Charts documentation site

The docs site, built with [Nextra](https://nextra.site) (Next.js) and statically exported to
GitHub Pages at https://marketcalls.github.io/openalgo-charts/.

## Run locally

The live, in-page chart demos import the real built library, so build it first:

```bash
# from the repo root
npm run build

# then start the docs site
cd website
npm install
npm run dev          # http://localhost:3000/openalgo-charts
```

`npm run dev` / `npm run build` automatically run `scripts/sync-lib.mjs`, which copies the
built bundles from `../dist` into `lib/oac/` for the demos.
The same step copies the standalone profile demo, its theme module and two
required bundles into generated `public/demos/` assets. Relative imports keep
that demo working under the website's `/openalgo-charts` base path.

To preview the actual static export:

```bash
npm run build
npm run preview      # http://127.0.0.1:4174/openalgo-charts/
# In another terminal, with the preview running:
npm run check:profile
```

## Profile screenshots

The source demo is `../examples/market-profile/index.html`. Edit its theme
presets in `themes.js`; the website embeds that same source after the sync step.
The gallery is at `/docs/market-profile-examples` and also appears on `/examples`.

From the repository root, with the library built:

```bash
node tests/e2e/serve.cjs
# In another terminal:
node scripts/capture-profile-screenshots.mjs
```

The capture script writes five theme PNGs at 1600 × 1000, DPR 1, 5 CSS pixels
per row, with identical synthetic sessions and the newest profile split. It
also captures packed/split close-ups at 12 CSS pixels per row. Screenshots are
tracked in `public/screenshots/market-profile/`; generated demo bundles are ignored.
Pass a full demo URL as the script's first argument to capture another local host.

The gallery and 2.1.0 release notes describe features present in the current source tree.

## Add or edit a page

1. Create an `.mdx` file in `pages/docs/`.
2. Add one entry to `pages/docs/_meta.ts` to place it in the sidebar (the key is the file
   name without extension; the value is the sidebar label). Use a `{ type: 'separator' }`
   entry to start a new section.

That is the whole workflow. Prose is plain Markdown.

## Add a live demo

Import the demo component and pass it a code string. The same string is both displayed
(syntax-highlighted) and executed, so the example can never drift from what readers see:

```mdx
import RunnableExample from '../../components/RunnableExample'

<RunnableExample height={320} code={`const chart = lib.createChart(el);
chart.addSeries('candlestick').setData(lib.generateBars(1700000000, 140, 3600));
chart.timeScale.fitContent(140);
return chart;`} />
```

Inside the code string, `el` is the chart container and `lib` is the library namespace. End
with `return chart;` so the demo tears down cleanly. To use a non-base tier, pass
`tiers={['transform']}` (or `'trade'` / `'profile'`).

Two rules for the code string (it is a template literal in MDX): no backticks, and no `${`
interpolation.

## Structure

```
pages/                 docs pages (.mdx) + _meta.ts sidebars; index.mdx is the landing page
components/            RunnableExample (live demos), landing sections, code highlighter
styles/globals.css     site + demo styling
theme.config.tsx       Nextra theme (logo, nav, footer, SEO)
scripts/sync-lib.mjs   copies ../dist bundles into lib/oac for the demos
public/api/            TypeDoc API reference (generated; served at /openalgo-charts/api)
```

Deployment is automated by `.github/workflows/deploy-docs.yml`.
