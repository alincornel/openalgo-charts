# Production workspace execution ledger

## Scope and baseline

Spec: `../specs/2026-09-19-production-workspace-design.md`.
All F1-F9 and P1-P6 requirements remain in scope until verified.

- Charts baseline: `1933d65`, worktree `D:/OpenAlgo-Voice/worktrees/charts-production`.
- Consumer baseline: `a4cc86f9d`, worktree `D:/OpenAlgo-Voice/worktrees/openalgo-production`.
- Both branches: `feat/production-chart-workspace`.
- Original main checkouts were clean and have not been edited.
- Issue 2078 and its comments read via the repository API. Three attached images inspected.
- Execution: native implementation with regression-first tests; independent final
  review as required by the execution skill. User authorized continuous execution.

## Findings

- Crosshair magnet currently controls price only; no independent center-snap option.
- LinkGroup currently has crosshair, viewport and symbol channels, no interval channel.
- OpenAlgo's Trading page repeats ChartPane toolbars and has no named workspace model.
- Built-in terminal volume currently uses one theme colour.
- Existing persistence is per-pane local storage; the backend also has chart preferences.
- Existing replay is per terminal and already locks the workspace's trading routes.

## Rulings

- Ruling: raise the combined base/trade budget from 86 to 87 kB and all tiers
  from 218 to 219 kB. The new snap/link/volume APIs measure 86.09 and 218.12 kB;
  the increase is intentional feature cost. Final release facts must be measured
  again after all phases, rather than claiming these intermediate figures.
- Ruling: unpack the npm candidate into only the isolated consumer's existing
  `node_modules/openalgo-charts` during development. The final local delivery
  will vendor a versioned candidate tarball with a portable file dependency and
  lockfile; no unpublished version or absolute worktree path will be required.

- Preserve the main checkouts through linked worktrees; use independent copied
  dependencies for the consumer harness. This permits local candidate validation.
- Implement the requested enhancements and readiness contracts in phases without
  treating any phase as completion of the overall goal.
- Do not present deterministic transport tests as live broker evidence or turn a
  numeric assessment into an unverifiable completion claim.
- Crosshair snapping resolves at paint time, preserving raw pointer coordinates
  and immediate toggling. A standalone histogram/column uses its first series;
  when a primary price series exists it remains authoritative for snapping.
- The consumer dependency tree contains a junction back to the source repository.
  The first copy followed it; its owned process was stopped after inspection.
  Further copying uses `/XJ`. Cleanup of the generated ignored `node_modules/openalgo`
  folder was rejected by automatic policy, so it remains untouched. No source
  files were modified or deleted. Do not recursively copy local package junctions.

## Progress

- Requirements and first implementation plan committed as `70f2b19`.
- Baseline: 5250/5251 library tests passed; existing packaging ACL test timed out
  under dependency-copy load. Its isolated rerun passed all 20 tests unchanged.
- Crosshair: 7 regression tests and the 120-test affected settings/state/pointer
  sweep pass. Browser paint assertions pass in Chromium, Firefox and WebKit;
  saved Chromium pixels inspected. Snap is centered and horizontal price stays raw.
- Interval linking: 8 new regressions and 75 affected link tests pass. A callback
  may return false to refuse an unsupported interval without claiming acceptance.
- Volume descriptor: all 5 new tests failed against baseline and now pass,
  covering warmup, replacement/append, direction/doji colour, settings changes,
  shared scale, missing volume and replay-prefix isolation. The existing
  indicator/spine/precision sweep passes 235 tests.
- Typecheck, changed-file lint and public-reference coverage pass. Build completed
  for snap/link; the later volume change still needs a candidate build.
- Consumer baseline: 110 targeted terminal/history/replay-lock/settings tests pass.
- Foundation candidate: lint/typecheck, 5271 unit tests, build, 231 demo tests,
  declaration checks, size checks and tree-shaking checks pass. Size checks were
  rerun after the intentional budget changes; other checks were unchanged.
- Consumer interval wiring: all 6 regressions failed with the packed candidate
  before migration; now 116 affected consumer tests and `tsc -b` pass. The sync
  menu includes interval and keeps the option off for existing saved preferences.
- Three browser crosshair screenshots inspected; the vertical line crosses the
  candle center in each. The horizontal crosshair stays at the pointer price.

## Remaining

All F1-F9, P1-P6 remain open at the integration level. Next: build/pack the library,
wire interval sync and volume controls in the consumer, then validate `/trading`.
