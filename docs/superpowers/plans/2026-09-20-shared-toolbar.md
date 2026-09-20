# Shared workspace toolbar implementation plan

> **For agentic workers:** Use superpowers:executing-plans for native implementation and regression-first verification.

**Goal:** Complete F9 with one toolbar acting on the selected chart in the OpenAlgo consumer and reference example.

**Architecture:** Chart panes retain terminal, dialog and control state. The consumer renders the selected pane's controls into a shared toolbar host using a React portal. Unselected and staging panes render no toolbar. Fullscreen returns the selected controls to their owning pane. Existing standalone ChartPane behavior and the published chart/widget APIs keep their defaults. The reference example already has one toolbar; its actions must resolve the focused chart consistently.

**Tech stack:** React, TypeScript, the existing terminal and grid ownership model, Vitest, Playwright.

**Spec:** `../specs/2026-09-19-production-workspace-design.md`, F9. User authorization covers continuing implementation and local validation without another design approval round. Shared replay remains F8 and will be opt-in for library consumers.

## Global constraints

- Preserve terminal identity, independent pane settings, drawing/study/alert state and feed ownership across focus changes.
- Preparing grids must never publish controls into the visible toolbar.
- Workspace transitions and replay continue to guard trading actions.
- No comparison product names in additions; use plain labels.
- Work only in the two isolated production worktrees. No live orders.
- The release target is 2.4.5; this phase does not publish a partial release.

## Review focus

1. Removing a focused pane must select a surviving pane without a stale terminal reference.
2. Portals must not allow staging grids or locked panes to publish interactive controls.
3. Keyboard selection and actual pointer focus must route actions to the same chart.
4. Fullscreen menus and screenshots must retain the selected chart's ownership.
5. A compact viewport must keep the toolbar reachable without overflowing the page.

## Task 1: Consumer toolbar ownership

Files: consumer `frontend/src/components/trading/ChartPane.tsx`, `ChartPane.test.tsx`, `WorkspaceGrid.tsx`, `WorkspaceGrid.test.tsx`, new `ChartToolbar.tsx`, `frontend/src/pages/Trading.tsx`; chart repository `scripts/check-openalgo-compat.mjs`, new `scripts/check-openalgo-toolbar.mjs`; consumer terminal user guide.

Interfaces: optional `toolbarHost?: HTMLElement | null`, `focused?: boolean`, `paneLabel?: string`, `chartSelector?: React.ReactNode` on ChartPane. Undefined host preserves the local toolbar; null means the shared host is not mounted yet. WorkspaceGrid accepts `focusedPaneId?: string` and publishes only from the active grid. Chart selection uses the existing `onFocusPane(terminal, paneId)` callback.

- [x] Add regression tests that render two real ChartPane components with one external host. Assert one toolbar, second-pane action routing after focus, unchanged terminal count, keyboard focus callbacks, no staging controls and fullscreen relocation.
- [x] Run `npm run test:run -- src/components/trading/ChartPane.test.tsx src/components/trading/WorkspaceGrid.test.tsx --maxWorkers=2`; observe failures for missing behavior.
- [x] Add the portal outlet, active-pane attributes and keyboard focus. Wire one toolbar host in Trading and active-only controls in WorkspaceGrid. Preserve or fall back focus on layout changes. Keep replay transport behavior unchanged until F8.
- [x] Run the two suites, affected trading/grid tests, typecheck/build and lint. Fix regressions before browser validation.
- [x] Add actual-browser checks for unique controls, chart-specific symbol/interval/type/studies/alerts/snapshot/replay, keyboard selection, layout reduction, named-grid preparation, fullscreen and compact layout. Run Chromium, Firefox and WebKit sequentially with D: temporary storage, inspect screenshots, retain reports.
- [x] Update the user guide and ledger, then commit the verified consumer implementation and browser checks locally.

## Task 2: Reference focused-chart controls

Files: discover the existing toolbar, split, indicator, snapshot and replay modules under `examples/yfinance/src`, and their unit/browser tests before editing.

- [ ] Audit every shared toolbar action against the focused chart; record primary-only behavior as failing regressions.
- [ ] Route symbol/interval/type/studies/snapshot/replay and relevant readouts through the selected pane while retaining independent state and source restoration.
- [ ] Verify focus changes, pane removal, interval/symbol sync, OI absence, volume styles/MA, alerts and replay guards with example tests and actual pointer/keyboard browser tests.
- [ ] Run the complete example/browser suites and update example documentation, ledger and local commit.

## Execution record

Pre-flight: consumer toolbar controls and dialogs already share ChartPane state; lifting that state would duplicate ownership. Portalling only the active control subtree preserves existing actions. Grid preparation already exposes an `active` flag, which must gate the portal in addition to CSS visibility. The original phase spec excluded publication; subsequent user instructions explicitly authorize the final release after the complete scope is verified.

Previous goal turn was a status response with preview verification, not implementation progress. Resume with consumer regression tests from charts `7079f46` and consumer `5846d7ae9`.

## Task 1 checkpoint

Consumer commit `3972843f7` implements one workspace toolbar with independent
pane state, keyboard focus, a visible selected-chart marker, fullscreen ownership,
inert transition controls and selection preservation/fallback on layout changes.
The chart selector stays visible while the other controls scroll. Original
standalone ChartPane defaults are retained. The chart package and public API have
not changed in this task, so this host UI change requires no library migration.

Six new unit regressions failed before implementation. The browser first exposed
the duplicated toolbar and later the selector scrolling out of view. The final
consumer suite passes 2299 tests in 142 files; the affected sweep passes 677.
Build/types pass. Changed-file lint is clean; full lint exits 0 with the existing
two warnings and two informational notices. The canvas test stub and large build
chunk warnings are retained. Generated tracked frontend assets were restored.

The combined consumer harness passes 59 checks per browser in Chromium, Firefox
and WebKit, 177 total, including Objects, foundation controls, OI, alerts,
templates, persistence, staging refusal/cancellation and named selection changes.
After pinning the selector, the toolbar and baseline checks pass 21 per browser,
63 total, and the full consumer suite/build were rerun. Selected desktop/mobile
screenshots were inspected. Fullscreen checks run when supported. The final
WebKit toolbar report retains one expected fixture reload cancellation notice;
no unexpected runtime errors or external HTTP were accepted. No real orders
were sent, and toolbar checks add no mocked orders.

Artifacts: `artifacts/candidate/toolbar-consumer-red.log`, `toolbar-browser-red.log`,
`toolbar-selector-red.log`, `toolbar-all-tests.log`, `toolbar-build.log`,
`toolbar-full-lint.log`, `toolbar-harness-lint.log`,
`toolbar-final-{chromium,firefox,webkit}.{json,log,png}`, and
`toolbar-selector-{chromium,firefox,webkit}.{json,log,png}` plus the toolbar
desktop/mobile images. Two animation frames after viewport restoration are
required before screenshots. Firefox may leave native fullscreen on Escape;
the harness exits it only if still active. The Objects identity assertion now
checks the stable study id required by alert restoration and a completed new
interval, replacing an obsolete expectation that rebuilding changes the id.

Static resource audit: the portal host is owned by the page; portal children
unmount with their pane. No transport, timer or subscription was added. A removed
unnamed pane clears a matching active terminal reference. This is not measured
endurance evidence. Narrow multi-column readouts remain crowded and are still
part of the broader responsive review before release.

Task 2 and the full F1-F9/P1-P6, live-broker, endurance and release scope remain
open. The package is still the local 2.4.0 candidate; final target is 2.4.5.

## Task 2 selection and snapshot checkpoint

The reference example now selects a chart by pointer press or keyboard focus.
Hovering another plot does not change ownership. Drawing controls and snapshots
use that selection. A captured snapshot menu keeps its original chart and request;
chart replacement or a changed request invalidates it. The image filename also
retains its original symbol and interval while asynchronous conversion finishes.
Closing the second chart selects the surviving chart through the same owner.

Four snapshot regressions and two selection failures were observed before the
implementation. The browser exposed a duplicate hover listener in drawing.js,
which was removed. Screenshot inspection then found the canvas covering the
selected-chart outline. A failing pixel assertion reproduced this; a transparent,
non-interactive border overlay now paints above the canvas in all three engines.
Selected-chart screenshots from Chromium, Firefox and WebKit were inspected.

Final checks pass: 255 example tests in 21 files, 40 reference browser tests,
repository typecheck and lint. Example JavaScript is excluded by the repository's
lint configuration; it is exercised by module, unit and actual browser tests.
The runner's existing NO_COLOR/FORCE_COLOR warning remains. Artifacts are
`reference-focus-final-{demo,browser,types,lint}.log` and the screenshots under
`artifacts/candidate/reference-focus-final-browser/`. Earlier failing runs are
retained as `reference-snapshot-red.log`, `reference-focus-red.log` and
`reference-selection-ring-red.log`.

Task 2 remains in progress: symbol, interval, chart type, studies, grid/readout,
settings, comparisons and replay still need consistent reference-pane routing.
This checkpoint changes no published library API or installed consumer package.
