# Reference named workspaces implementation plan

> **For agentic workers:** Use superpowers:executing-plans for continuous native implementation. One independent whole-branch review remains near release.

**Goal:** Complete reference F1 with named, portable layouts and safe workspace switching, using the existing library document and repository contracts.

**Architecture:** Translate the reference host's complete layout snapshot into the optional workspace tier. Validate host support and prepare every primary history before publishing a switch. Use the existing IndexedDB adapter and WorkspaceRepository for atomic catalog writes, with a compact host dialog for names, recent entries, autosave and file transfer. Keep the current local snapshot as crash recovery and legacy migration input.

**Tech Stack:** Reference JavaScript modules, workspace tier, IndexedDB, current host controls, Vitest and three-engine Playwright.

**Spec:** `../specs/2026-09-19-production-workspace-design.md`, F1 and the persistence portion of P4. F2 templates remain the following phase.

## Global constraints

- Charts 2.4.5 publishes before remaining /trading implementation and final broker/deployment validation.
- Original OI modifications and isolated consumer changes remain untouched.
- No comparison brands, new icons or long dash characters in additions.
- Files contain configuration only. No history, credentials, orders, positions or armed state.
- Existing host reload/import behavior remains readable. New named operations use the library contract.
- Reference geometry supports one chart or two horizontal charts. Reject imported geometry or settings that this host cannot honor before any mutation; never silently discard a pane.
- Replay, pending source loads and settings previews cannot be saved as a live layout.

## Review focus

1. An imported grid with reordered pane records restores by slot position and retains selected ownership.
2. A failed, canceled or superseded preparation leaves the current workspace and catalog selection intact.
3. A revision conflict or blocked storage write is visible and does not replace the last good workspace.
4. Repeated studies, their identities/styles/pane grouping and drawing-anchored fired alerts survive snapshots without replaying history.
5. Crosshair/viewport and symbol/interval linking cannot rewrite restored independent sources during a switch.

## Task 1: Complete reference document adapter

Files: add `examples/yfinance/src/workspace-document.js` and
`examples/yfinance/tests/workspace-document.test.js`; document the host boundary.

Interfaces:

```js
workspaceFromLayout(layout, { magnet, stay }); // validated WorkspacePayload
layoutFromWorkspace(payload); // validated schema-2 host snapshot
validateReferenceWorkspace(payload); // host-supported WorkspacePayload
```

- [x] Add round-trip regressions for both independent sources, transformed type,
  timezone, grid widths, focused chart, links, volume settings, comparisons,
  repeated/custom study identity/styles/grouping, drawings and fired alert state.
  Test reordered pane records, single charts, unknown host metadata and privacy.
- [x] Run the new suite and observe missing behavior.
- [x] Implement allowlisted host settings and library validation. Keep indexed
  comparison mode and its previous scale mode as namespaced settings; preserve
  standard comparison visibility/color. Reject unsupported geometry, exchanges,
  periods, types and host settings before restoration. Import chart types only
  if the current host recognizes them. Do not silently flatten a larger grid.
- [x] Run all reference unit tests, lint/types and browser snapshot round-trips
  using real chart state in three engines. Inspect evidence, document and commit.

Task 1 evidence: missing-module regression observed before implementation, then
21 adapter cases pass. A legacy partial-volume case separately reproduced lost
visibility and passes after the fix. Full reference suite: 324 tests in 25 files.
Lint/typecheck pass. Real two-chart snapshots round-trip in Chromium, Firefox and
WebKit, including every actual getState field and repeated study identities.
Browser checks pass on the final adapter. No visual controls changed in this task.
All command logs are under artifacts/candidate/reference-workspace-document-*.
The first full suite caught the expected module-inventory update; documentation
and the existing inventory check now include the adapter.

## Task 2: Prepare and install complete workspaces

Files: add `examples/yfinance/src/workspace-transition.js`, `workspace-host.js` and tests; modify
`main.js`, `split.js`, `persist.js` and reference browser tests.

- [x] Add failing tests for all-history preparation, distinct request timezones,
  expression cancellation, stale completions, missing source data and rejection
  before mutation. Capture current raw bars for rollback; transformed bars are
  not a valid input to rebuilding the old chart.
- [x] Add synchronous prepared-data installation paths for primary and secondary
  charts, retaining existing data loading defaults. Validate each restore report.
  Hold alert/save/order guards throughout publication; restore drawings before
  alerts and each source before its data context is made active.
- [x] Prepare all pane histories before publication. Keep the displayed workspace
  intact during preparation. Check ownership/revision before persistence and
  publication. Cancel previous preparations and dispose their listeners/signals.
  Restore the captured old snapshot on a synchronous publication failure.
- [x] Verify source/type/zone and split geometry changes, failed fetch/write,
  cancellation and context change, firing history silence and no future replay
  data saved. Run affected unit/browser tests and commit.

Task 2 uses a separate workspace-host.js for current chart ownership and page
guards. The installer establishes split geometry before constructing the primary,
restores drawings before alerts, and captures raw feed bars for rollback so a
transformed chart is never transformed twice. A storage callback can return a
revision-checked rollback receipt for installation failure or a stale owner at
the commit boundary. Linked source disagreements and unsupported/malformed drawing
documents are rejected before requesting history. Catalog/UI actions remain Task 3.

Validation: 17 transition cases, the full 346-test reference suite in 26 files,
lint and typecheck pass. The full reference browser sweep passes 112 cases across
three engines, including history/storage gating, context cancellation, actual
transformed-chart rollback and restored-alert history silence. A final 12-case
three-engine transition sweep covers the completed receipt handling. Successful
installation screenshots were inspected in all three engines.

The first full sweep passed 111 cases; one rollback fixture was stopped by the
ownership guard before reaching its injected failure. Eight diagnostic repetitions
passed without identifying a specific changed field. The fixture now waits for
its initial transformed charts to render before capturing the rollback baseline;
the production guard was not weakened. The final full sweep passed without retries.
Logs and screenshots are under artifacts/candidate/reference-workspace-transition-*.
No library bundle, consumer dependency or publication changes in these tasks.

## Task 3: Named catalog and host controls

Files: add `examples/yfinance/src/workspaces.js` with reference tests; modify
`toolbar.js`, `main.js`, `persist.js`, `index.html`, `styles.css`, reference README
and browser tests. Keep UI separate from document and transition logic.

- [ ] Add failing cases for create, save, open, rename, duplicate, delete, recent
  ordering, autosave and import/export. Exercise failed storage, catalog conflict,
  reload with autosave off, replay guards and pending-operation cancellation.
- [ ] Initialize WorkspaceRepository with an explicit reference namespace and
  IndexedDB storage. Retain the legacy snapshot as recovery; migrate once without
  deleting it. Surface storage failures and retries. Do not claim a failed write
  was saved, and do not silently swap to another storage backend.
- [ ] Add compact, accessible named-layout controls to the existing toolbar using
  plain labels and the existing dialog/focus/fullscreen patterns. Expose all CRUD,
  recent, autosave and portable JSON actions. Route open through Task 2 and keep
  file errors visible. Export a validated snapshot, not runtime objects.
- [ ] Connect autosave only to the active named layout when enabled, with captured
  ownership and serialized writes. A session recovery snapshot must not overwrite
  a disabled named autosave. Restore the active named layout on reload using its
  source metadata before requesting history.
- [ ] Run full reference tests and three-engine browser CRUD/restore/failure checks;
  inspect desktop and narrow screenshots. Run lint/types, update example docs and
  the main ledger, and commit. Then continue F2 and remaining release requirements.
