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

## Baseline findings

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
- Typecheck, changed-file lint and public-reference coverage pass. The built
  foundation candidate includes snap, interval linking and the volume descriptor.
- Consumer baseline: 110 targeted terminal/history/replay-lock/settings tests pass.
- Foundation candidate: lint/typecheck, 5271 unit tests, build, 231 demo tests,
  declaration checks, size checks and tree-shaking checks pass. Size checks were
  rerun after the intentional budget changes; other checks were unchanged.
- Consumer interval wiring: all 6 regressions failed with the packed candidate
  before migration; now 116 affected consumer tests and `tsc -b` pass. The sync
  menu includes interval and keeps the option off for existing saved preferences.
- Three browser crosshair screenshots inspected; the vertical line crosses the
  candle center in each. The horizontal crosshair stays at the pointer price.
- Library foundation implementation committed locally as `d417532`.
- Consumer built-in volume now follows displayed candle colours (including
  previous-close colour rules), supports a configurable MA on the same scale,
  and follows transformed/live/replayed data without reading future bars.
- Actual StrictMode browser execution exposed a destroyed LinkGroup reused by
  an effect restart. The Trading page now creates and destroys each group in
  the same effect lifecycle; interval convergence survives reloads.
- Firefox exposed page visibility notifications arriving during the outgoing
  page's render. A regression first reproduced the React warning; the hook now
  queues captured event snapshots, with an unmount guard. Related option-chain
  tests await the notifications before simulating a return to the page.
- Consumer verification: 514 tests across 38 affected files pass with
  `--maxWorkers=2`; changed-file lint, typecheck and production build pass.
  An earlier unrestricted-worker run exhausted this machine's available memory;
  it is not counted as a successful run. Use bounded workers for this workspace.
- Consumer foundation implementation committed locally as `3e9cfaaa8`.
- The consumer vendors `frontend/vendor/openalgo-charts-2.4.0-d417532.tgz`
  (1,128,048 bytes) with a portable file dependency. Its computed SHA-512 matches
  the lockfile. Generated tracked frontend assets were restored after the build;
  the source and package candidate are the reviewable local delivery.
- Browser harness now supports Chromium, Firefox and WebKit, includes settings,
  interval persistence, replay-prefix MA and both volume palettes, and records
  actual console Error messages, error stacks and failed network requests.
- WebKit can report caught fetches on a departing document as access-control
  page errors. Reports retain these notices separately only during reload and
  only for the fixture's own API/Socket.IO URLs. Window errors and unhandled
  promise rejections are asserted separately and must remain empty. These are
  synthetic transport checks, not evidence of real broker connectivity.
- Final foundation run: all 24 checks pass in each of Chromium, Firefox and
  WebKit. Light and dark screenshots were visually inspected in all three.
  WebKit wraps the first pane's narrow OHLC legend; the shared-toolbar and
  responsive-workspace phase still owns the remaining presentation work.

### Reproduce the current checks

From the consumer's `frontend` directory:

```text
npm run test:run -- src/lib/trading src/components/trading src/hooks/usePageVisibility.test.tsx src/hooks/useOptionChainLive.test.tsx --maxWorkers=2
npm run build
```

From the chart library, repeat for `chromium`, `firefox` and `webkit`:

```text
node scripts/check-openalgo-compat.mjs --frontend D:/OpenAlgo-Voice/worktrees/openalgo-production/frontend --objects true --navigation true --branding true --foundations true --browser chromium --label foundations-chromium --output artifacts/candidate/foundations-chromium.json --screenshot artifacts/candidate/foundations-chromium.png
```

Reports and screenshots are generated local artifacts. The portable consumer
package source commit and lockfile integrity are recorded above; no release has
been published and the main checkouts remain unchanged.

## Remaining

### Workspace documents and persistence foundation

The optional `openalgo-charts/workspace` tier now provides validated full-grid
documents, indicator templates, an async catalog repository and an IndexedDB
adapter with atomic revision checks. Document imports create fresh identities.
Namespaces are immutable per repository, rejected saves remain rejected, and
corrupt stored catalogs are not overwritten. Hosts still own controls, restoration
and autosave orchestration; this does not complete F1, F2 or P4.

Evidence: document/repository RED runs observed before implementation; an actual
`Chart.getState()` test caught zero auto precision and additional settings slices.
The 36 new unit tests pass. All 5,307 library tests (220 files), 231 demo tests
(16 files), lint, typecheck, build, declaration guard, public-reference coverage
(901/901), size and tree-shaking checks pass. Four new IndexedDB browser tests
failed against the missing factory, then all 12 executions passed across Chromium,
Firefox and WebKit: reload/account separation, simultaneous tab writes, stale or
corrupt storage preservation, and close/version-change lifecycle.

Ruling: the new tier has its own 6 kB Brotli budget (4.80 kB measured). The all-tier
budget rises from 219 to 223 kB for the added optional module (222.92 kB measured).
Base 78.48 kB, widget terminal 184.71 kB and tree-shaken chart-only 49.92 KiB are
unchanged. Ruling: document magnet modes retain off/weak/strong; snapshots retain
the full settings/timezone contract and minMove 0. These preserve existing state.

Ruling: document, repository, browser adapter and package wiring are committed as
one verified foundation because they form the usable public entry point. The
tracked plan and this ledger carry the native Windows execution record rather
than introducing a second shell-specific task ledger. Host work remains a
separate phase.

User started the real OpenAlgo backend on port 5000. A dedicated read-only browser
is open for their login; its private profile and control script are ignored local
artifacts. No authenticated live-market result is claimed yet.

Foundation source commit: `566858e`. Packed candidate:
`openalgo-charts-2.4.0-566858e.tgz`, 1,141,884 bytes,
SHA-512 `bNXJPmaAxViYOWdWvx3mxPWxFgMwXHwCVvIrWKc0d6BO9Wc75I4pcS2bztLySIannUru3Ux7wadrOuzYhV5yOg==`.
A separate consumer package directory successfully typechecked shared Chart/state
types against the extracted tarball and executed a workspace storage round trip.
Consumer commit `3c1a90a8f` vendors this candidate and matches its integrity.
All 514 affected consumer tests (38 files) and `npm run build` pass; the build
retains its existing oversized visualization-chunk warning. Generated frontend
assets were restored. The actual consumer with this package passes all 24 Chromium
fixture checks, with zero page errors/runtime events; deliberately injected
network failures and the expected analyzer refusal remain in the console report.
Artifacts: `artifacts/candidate/workspace-package-chromium.{json,png}` and
`workspace-consumer-{tests,build}.log`. Other rendering engines retain the prior
foundation evidence; the new storage functionality has current three-browser
coverage as recorded above.

Live-session handoff initially reached a different browser. The user subsequently
logged into the dedicated window; `/auth/session-status` then confirmed the
authenticated broker session. Never copy another browser's cookies.

### Real backend observation and priority correction

The development frontend on port 5176 uses the actual backend on port 5000 with
the dedicated authenticated browser. History returned 1,512 BHEL/NSE 5-minute
candles with sorted times and valid OHLC. Exact symbol search, supported intervals,
an authenticated socket and a market-data frame were observed. The 1-minute
history subsequently loaded; the immediate post-switch snapshot still contained
old bars, so readiness assertions must use `chart.getDataContext().interval`.
No live orders were sent; the browser blocks execution routes.

This is read-only adapter evidence, not an endurance run or proof of fresh exchange
trades. A cached mode-3 snapshot carried `ltt: 1789732772` and a delivery
`timestamp: 1789833463417`. The parser used the newer delivery time and created a
new delivery-day candle. Ruling: address timestamp provenance before proceeding
with the next template UI task. Prefer valid explicit trade/market event times,
then delivery time for legacy payloads; retain seconds/milliseconds/ISO support
and add numeric-string support. Seven parser regressions reproduced the defect
before the correction. Calendar/unknown-time policies remain required under P1;
this fix alone does not establish session correctness.

Ignored sanitized evidence: `live-openalgo-candidate.json`,
`live-openalgo-timestamp-probe.json`, and `live-indicator-template-methods.json`
under `artifacts/candidate`. The terminal template methods were also exercised
against actual loaded bars: four instances including exact repeats and a shared
oscillator pane survived an interval rebuild, with price data and viewport
preserved; the previous studies were restored afterward. The template picker and
account-bound catalog hook are not yet implemented.

The full consumer suite initially exposed two visibility-transition test failures
in `StrategyBuilder.test.tsx`. Both dispatched hidden/visible in one synchronous
turn while the shared hook deliberately defers state to a microtask. The tests
now flush each real-world event boundary; all 33 tests in that file pass and the
full suite passes 2,134 tests across 126 files. Existing simulated-DOM canvas
warnings remain in its log. Modern study persistence also rejects an explicit
null pane index; a regression reproduced its previous accidental coercion to zero.

The market-time correction passes all 5,314 library tests, 231 demo tests and the
complete `npm run verify` gate (lint, types, build, declarations, size, tree
shaking). Negative numeric strings no longer pass through permissive date parsing.
Public reference coverage is 901/901. The final all-tier bundle is 222.95 kB,
widget terminal 184.75 kB and chart-only tree-shaken import 49.92 KiB, within the
existing budgets. The new packed candidate still needs live backend verification.

The user reiterated the naming restriction. Added-line and commit-message scans
against both branch baselines found zero restricted comparison-name matches.

F3 and F5 have library and consumer implementations and regression evidence.
F4/F6 also have consumer coverage; the reference host's built-in volume controls
still need integration. The whole goal remains open: complete the reference
host, named workspace documents/storage and templates, shared controls,
comparison/replay coordination, and every P1-P6 readiness requirement.

Keep the replay-loading lock gap in scope: `beginReplayAt` clears picking before
awaiting sub-bars, while the replay controller is still absent. Coordinated
replay must hold the workspace lock through that await and handle cancellation.

### Indicator templates in the consumer

Task 1 is committed as consumer `1de1c37dd`: modern version-2 preferences
retain exact repeated studies and pane placement, while legacy arrays retain
their previous duplicate-healing policy. The terminal validates every descriptor
before replacing studies, checks chart ownership after module loading and rolls
back a thrown restore. Price bars and viewport are preserved.

Task 2 is committed as consumer `744c18d12`: the catalog hook creates an adapter
in the account effect, counts pending operations, closes on cleanup and rejects
obsolete account completions. Nine tests use the real repository, including
failed writes/retry, account switch, unmount, reload and StrictMode.

The consumer now vendors source `7e27c3c` in commit `679f8b7a4`:
`openalgo-charts-2.4.0-7e27c3c.tgz`, 1,142,277 bytes, SHA-512
`WdGF1RtEKi0RUqS/JYkpfkFrXUM2jgJqU8MztI8rZXFihg/Ui0nyfSzlxMgWBxs7doFKhxrLths3nCJ9+2KWFQ==`.
The lockfile and extracted package match. Real authenticated market evidence in
`live-market-time.json` confirms that `ltt: 1789732772` is retained despite a
later delivery timestamp; the resulting 5-minute last bar is 1789732500, with
1,513 sorted valid-OHLC bars and no delivery-day candle. Session-calendar
validation remains open because that reported event time is after cash hours.

The dialog is committed as consumer `92e55c173`. Eight component tests and all
539 affected consumer tests pass. The initial full UI suite passed 2,151 tests
across 128 files. Browser regressions exposed focus stealing by the first pane
when its shared control opened; workspace controls now preserve the selected
pane. Firefox also exposed a visibility notification whose microtask still ran
inside a render. A failing unit regression now requires the next browser task;
pending timers are cancelled on unmount. Visibility tests must flush that task
before sending the opposite transition. The correction is committed as
`4a02be54e`; all 2,152 consumer tests across 128 files now pass. Full consumer
lint, type build and production build pass; the existing large visualization
chunk warning and simulated-DOM canvas notices remain. Generated tracked assets
were restored after the build.

Mobile assertions now finish the dialog resize transition before measuring its
width. The dialog is constrained to a 16-pixel viewport margin; screenshots
disable finite animations so they show the settled surface. All 26 compatibility
checks now pass in each of Chromium, Firefox and WebKit. Current reports have zero
page errors and runtime events; console counts 28/1/30 include only injected
resource failures and the expected mode-mismatch refusal. An earlier WebKit
reload also reported a caught custom-index fetch as a page error; the narrowly
scoped departing-document diagnostic classifier now covers that exact local
index URL, retaining the notice separately. Window errors/rejections still fail.
Desktop and narrow screenshots were visually inspected. Reports and images:
`artifacts/candidate/templates-{chromium,firefox,webkit}*`.

The live dialog also saved, reapplied and deleted a temporary empty template in
the authenticated account, preserving the actual market context and 1,513 bars.
Its final apply measured 1,968 ms; a preceding live wait exceeded 10 seconds but
was later observed complete. These are individual checks, not a performance
guarantee or fresh-trade evidence. Both temporary validation entries were removed.
The earlier live method probe covers four study instances and interval restoration.
Sanitized live dialog report: `artifacts/candidate/live-template-dialog.json`.

The focused-chart template consumer phase is complete. F1 full-grid layouts,
reference-host controls, comparisons, shared replay/toolbar and P1-P6 remain
required. The score remains an assessment; these checks do not establish a
90-point production claim. Added-line, untracked-file and local commit-message
scans still contain no excluded comparison names.

### Named-grid preparation

Plan: `2026-09-19-named-grid-workspaces.md`. Optional row/column weights now
preserve unequal grid tracks in portable documents. Eight new regressions failed
against the previous parser; all ten new cases and the 46 document/repository
tests now pass. The full library gate passes lint, types, 5,324 unit tests, build,
231 demo tests and eight declaration entry checks. Public references remain
901/901. The initial aggregate size check exceeded its old 223 kB limit by 42 B.
Ruling: weighted-grid validation is intentional optional-tier cost, so the all-tier
budget becomes 224 kB (223.04 measured); the workspace tier remains below its 6 kB
budget at 4.89 kB. Base 78.51 kB, widget terminal 184.75 kB and tree-shaken
chart-only 49.92 KiB are unchanged by these document fields. Size and shake
checks pass after that budget adjustment. Packing and consumer validation remain.

Weighted-grid source is committed as `117fb9d`; consumer `e9a2b4c47` vendors
`openalgo-charts-2.4.0-117fb9d.tgz`, 1,142,510 bytes, SHA-512
`tagbi0XKqdt1t7TwKaNMiQ0qOUcIT3LDIFtqtNGkZdZX4kkvj3lTA/XWKC7sWfZW/5yZSIt0sgrGH5BhqCFuqg==`.
Consumer build/types and 544 affected tests across 40 files pass; the installed
candidate passes all 26 Chromium compatibility checks. No additional engine
interaction changed; the prior three-browser template evidence remains separate.

Consumer `c558093a0` introduces pane capture and injectable preferences. Four
preference regressions reproduced ignored adapters and blocked-storage crashes;
five now pass. Capture regressions were observed against the absent method; ten
cases now cover detached settings/studies/drawings and rejecting stale history,
replay, pending study/drawing loads and unavailable charts. All 83 tests in the
two terminal files pass, formatting/lint and TypeScript build pass. A real
authenticated chart capture retained its symbol/interval, viewport, volume and
drawings envelope without forbidden execution keys (`live-workspace-capture.json`).
The live Vite dependency cache still owns the earlier market-time package; the
weighted package was tested in the fresh compatibility server. Prepared initial
restoration and atomic grid publication remain unimplemented.

Consumer `fa14464a8` completes the prepared-pane boundary. Initial documents are
validated and detached before terminal listeners, and their preferences use a
private map. Startup rejects missing metadata/history, unsupported type/interval,
missing studies, incomplete drawing restoration and cancellation. It awaits
settings, restores studies once, applies host series styles, and preserves weak
snapping. Volume visibility stays authoritative for both histogram and average.
Preparation holds the terminal trading lock, and failed initialization destroys
its resources idempotently. Ordinary unnamed startup retains its fallback.

Ten initial startup cases failed before implementation; drawing pane lookup,
the loading refusal message and volume-average visibility also have observed
RED regressions. All 417 affected consumer tests in 27 files pass, as do changed
file lint/formatting and the TypeScript build. The scoped resource audit verifies
data-owner destruction, socket close, visibility listener removal and zero
remaining fake timers on failure, with static checks of the other exits. This
is not a long-running process resource measurement.

The authenticated browser restored two identical averages and two oscillators
sharing a pane (one hidden, lengths 14 and 7), a trend line, weak snapping,
hidden volume and the exact viewport. The original chart retained its 1,513 bars
and zero studies, and the prepared chart read 1,512 history bars; no browser
preferences were written and One-Click remained off. Final preparation measured
148 ms with cached responses, not a latency guarantee or fresh-trade evidence.
Report: `artifacts/candidate/live-workspace-startup.json`. The live browser still
uses its prior cached engine tier; this change is consumer orchestration.
Grid publication, its menu, autosave and three-browser grid acceptance remain.

Grid conversion is consumer `5eede30c0`: 14 tests preserve every preset, unequal
tracks/spans, explicit imported geometry, focus/sync and all 16 allowed panes.
Imported pane IDs never become CSS. Consumer `a7f0f7bbd` adds the coordinator:
eight tests cover readiness order, failed history/storage, supersession, account
teardown, prompt cancellation and reentrant factory cancellation. This owner is
not yet connected to the page; the rendering and menu work remains.

Library `2f6b54c` adds cancellable activation and an optional expected catalog
revision. Four repository regressions and a real-browser pending-write regression
failed before implementation. Cancellation aborts the pending browser transaction
and removes its listener at completion/abort. A committed transaction cannot be
undone by cancellation. A changed prepared revision rejects before activation.
The full library gate passes 5,328 tests in 220 files, 231 demo tests in 16 files,
lint/types/build, eight declaration checks, size and tree-shaking. Workspace is
5.02 kB Brotli and aggregate 223.17 kB; base 78.51, widget terminal 184.75 and
chart-only 49.92 KiB remain unchanged. References cover 901/901 runtime names.
All 15 storage tests pass across Chromium, Firefox and WebKit.

Consumer `72b2280c2` vendors `openalgo-charts-2.4.0-2f6b54c.tgz`, 1,142,991 bytes,
SHA-512 `a/2h5Gwkh6GG7Aran/D/V11Qv9GJ9ZAIcN8s1boIVWq3UmTW42htGa+hzak7cURafGw0rtGhXwq3QRNeOlbzNg==`.
The installed candidate passes the consumer build/types, 596 affected tests in
44 files and all 26 Chromium compatibility checks. The screenshot was inspected;
the already-scoped shared-toolbar work remains necessary for narrow grid panes.
The existing large visualization chunk warning remains. Generated tracked assets
were restored. Reports: `workspace-activation-*` and `activation-candidate.*` under
`artifacts/candidate/`.

### Final release version

Consumer `0be0a0a49` added explicit workspace transition locks and destroyed-owner
execution refusal. Two observed failures now pass with the 106-test affected
suite. These locks still need to be connected to grid publication in the page.

Issue 2077 is implemented in library `deb6de3` and consumer `9860b3b69`: selected
OHLC/study values survive live updates, linked readouts follow the follower's own
bar, zero volume is readable, built-in index volume is hidden, mouse plot pan
preserves automatic fitting by default, and expression adapters expose combined
leg activity. See `2026-09-19-chart-correctness-2077.md` for reproduction, package
integrity, test/browser evidence, bundle cost and the connected-session limit.
Full consumer suite: 2,221 tests in 133 files. Full library suite: 5,339 tests in
221 files plus 232 reference-host tests. All 34 compatibility checks pass in each
of Chromium, Firefox and WebKit after the documented fixture timing corrections.
The development candidate is still version 2.4.0; nothing has been published.

The user also added issue 2077 and explicitly requested validation before fixes.
Plan `2026-09-19-chart-correctness-2077.md` covers its six chart correctness reports.
These are now validated and corrected. Resume the pending named-grid UI and every remaining
production requirement. This extends the scope; it does not replace the release
or earlier feature requirements.

The user selected **2.4.5** for the final validated chart package and its OpenAlgo
`/trading` integration. After completing the remaining implementation and gates,
update library release metadata, build and pack that exact revision, and update
the consumer's vendored dependency, lockfile integrity and integration guide.
Re-run compatibility against the final archive. The current 2.4.0 candidates are
development checkpoints; a version change alone is not readiness evidence.
The user's subsequent instruction authorizes the final commit and push, npm
publication, website deployment and GitHub release. This supersedes the earlier
local-only restriction for the final validated release and companion integration.
Read `CLAUDE.md` before release and follow its complete measured-facts checklist,
including all repeated website, README, diagram, example and API facts. Push and
wait for CI; push the immutable tag and manually dispatch the Release workflow
for trusted npm publishing. Create the GitHub release after npm succeeds, deploy
Pages with its workflow, compare registry contents with the tested archive and
verify the deployed site in a real browser. Finally install the published package
in the consumer, rerun its checks, commit and push the integration. No additional
publication confirmation is required by the existing authorization.


### Named-grid consumer checkpoint

Consumer `a297af9f8` completes the prepared grid, workspace menu and autosave
integration with the verified `87f1589` engine candidate. The full suite passes
2,253 tests across 139 files; types/build and changed-file checks pass. Full lint
has the existing two warnings and two style notices recorded in the named-grid
plan. All 21 workspace checks pass in each of Chromium, Firefox and WebKit,
including storage refusal, stale catalog recovery, history failure, cancellation,
imports and locked execution. The corrected template fixture passes 15 Chromium
checks. Screenshots were inspected; generated tracked build files were restored.

Observed cleanup errors cannot release an already published grid or prevent
other owners from being released. Save as retains changes made during the write;
unchanged gestures settle back to Saved even with autosave off. Resource checking
covers owner maps/sets, links, timers, abort listeners and export URLs through
static review and regressions. Prolonged process/memory measurements remain P3.

### Additional open-interest and alert scope

On September 20 the user explicitly added
`D:/OpenAlgo-Voice/codex instruction/openalgo-charts-oi-and-alerts.md`.
Its complete requirements are preserved in
`../specs/2026-09-20-open-interest-and-alerts-requirements.md`.
They extend F1-F9/P1-P6 and the 2.4.5 release; they do not replace any prior row.
The eight initial open-interest edits exist uncommitted in the original charts
checkout. Keep that checkout intact; port its diff into this isolated branch,
then validate and finish the data paths, indicators, availability and status line.
Implement alerts as the requested base-engine controller with drawing/indicator
anchors, policies, lifecycle, rendering, events and versioned persistence, plus
schema-driven widget controls and compatible consumer integration. No alert sends
an order or delivers a webhook itself. No release is complete until this added
scope and the previous scope have evidence.


Open-interest plan: `2026-09-20-open-interest.md`. The supplied eight-file patch
is incorporated without changing the original main checkout. Data-path tests now
cover latest-level folding, absent/zero, live quote gaps, history reconciliation,
partial replay, cold-cache validation and transform omissions. The engine gate
passes 5,363 tests in 222 files plus 232 reference-host tests, lint/types/build,
declarations, size/shake and 901/901 reference coverage. Ruling: the optional
field's measured aggregate cost raises the widget-terminal budget from 185 to
186 kB (185.13 measured). Studies, capability/status UI, alerts, packed consumer
migration and all earlier unfinished scope remain required. The separate
OpenScript workflow is not being modified; document its `oi` and
`hasOpenInterest` integration contract when Task 4 is implemented.


## Studies and capability checkpoint

All nine new study tests failed before registration, then passed. Additional
regressions exposed the histogram appearance control and interval capability
reset; both were observed failing and corrected. Capability, status-line and
widget settings tests cover unknown, false, true, zero, missing, restore and a
capability-only context change. The no-dead-controls suite needed an actual OI
reading in its shared legend fixture; all thirteen chart types then passed.

Verification: lint, types, 5,382 tests in 223 files, build, 232 reference-host
tests and eight declaration checks passed. All three browser projects passed
rendered candle-color, raw-line gap, change gap, hovered zero and capability
control assertions. Chromium and Firefox study screenshots and the WebKit
unavailable-control screenshot were visually inspected.

Ruling: instrument capability is a separate legend option, not a destructive
rewrite of its saved readout switch. This preserves per-legend and chart
preferences through unsupported instruments. A standalone legend may receive
the same optional flag. Unknown capability permits a supplied observation.
If metadata is wrong, a host could suppress a valid reading; hosts own its truth.

Ruling: check the study and capability pixels together in one fixture to cover
the complete readout interaction. All three browser engines execute it.

Ruling: increase the all-tier budget from 224 to 225 kB for the three studies
and capability/readout integration. It measures 224.46 kB. Base is 78.92 kB,
indicators 29.84 kB, widget 42.68 kB and widget terminal 185.98 kB. Size and
shake pass after the budget change; chart-only is 50.25 KiB within 50.25.
Runtime counts are 105 studies: Trend 36, Momentum 29, Volatility 22, Volume 18.
Skills coverage is 907/907. Repeated public counts and final release sizes
remain part of the release documentation gate.

Task 3 is complete. Task 4's engine and widget behavior is implemented and
validated; full metadata threading is retained with Task 5. Reference-host and
OpenAlgo consumer migration, packed-candidate installation and consumer checks
are next. Alerts and the remaining production plan remain required.

The user explicitly froze the readiness score at 82 overall / 85 engine,
confirmed full remaining scope for 2.4.5 and renewed publication authorization.
Do not raise the score or publish a partial candidate.

Reference OI host/adapter checkpoint: request-scoped metadata removes unsupported
history OI before cache; the example preserves capability through rebuilds and
supports the optional readout. See the OI plan for red/green evidence, 5,383
library tests, 235 reference-host tests, six browser cases, API/skills validation
and the measured 186.1 kB terminal-budget ruling. Consumer migration and alerts
are still unfinished; this is not the final release candidate.

OpenAlgo OI checkpoint: consumer bcd334203 installs byte-verified b26d6d5 and
implements instrument capability, history placeholder suppression, the optional
selected-bar readout and disabled controls. All 2,259 consumer tests and the
production build pass. Each of three browser engines passes 17 actual /trading
checks including futures gaps/zero, crypto metadata and workspace restoration.
See the OI plan for artifacts, static resource review, warnings and limitations.
OI live-broker validation, reference secondary shared controls and final release
facts remain; alerts are entirely unimplemented and remain the next major feature.

Alert widget checkpoint, 2026-09-20: alert Tasks 1-5 are now implemented and
validated, including the engine, source bridges, drawing visuals, persistence,
widget editor/list and context menus. Full library suite 5508/5508; reference
suite 235/235; eighteen alert browser cases across three engines. Actual desktop
and narrow screenshots were inspected. API, declarations, skills, size/shake
and website build pass. The alert plan records regressions and measured limits.
Reference/yfinance and OpenAlgo /trading alert controls are not integrated yet.
Task 6 must migrate those hosts and install/test the exact packed candidate.
Connected-broker validation, remaining F/P production scope and final release
facts/publication remain required. The frozen readiness score is unchanged.

Reference alert checkpoint, 2026-09-20: yfinance now owns alert evaluators and
the shared editor/list for both charts. It persists their source identities,
drawing anchors and lifecycle records across rebuild and reload. Its replay
loading/cancellation and history-cache identity gaps are fixed; simulated
order/bracket execution is guarded throughout replay and data loading.
Full library 5511/5511; reference modules 244/244; reference browser suite
28/28, including twelve alert cases across all three engines. API, types,
lint, build, declarations, skills 917/917, size/shake and website build pass.
Real yfinance history and the editor were checked on the running 8125 server,
with 251 bars and no orders/fills. This does not prove connected-broker behavior.
Alert Task 6 remains open for the exact packed OpenAlgo consumer migration.
The remaining F/P requirements, final review, release facts and publication
remain required; version 2.4.5 is unpublished and the frozen score is unchanged.

Consumer alert checkpoint, 2026-09-20: OpenAlgo commit `834b582cc` installs the
exact packed chart build `2a7ca17` and integrates the alert toolbar, editor/list,
local delivery, preserved study/drawing anchors, workspace state and replay/data
loading guards. All 33 installed package files match. Full frontend suite is
2271 tests in 141 files; build/types and coverage pass. The combined browser
harness passes 43 cases each in Chromium, Firefox and WebKit, with inspected
desktop/mobile alert screenshots. No real orders were sent. The detailed alert
plan records warnings, resource review and remaining consumer gates. This is
another development checkpoint, not completion of Task 6 or the release.

Alert lifecycle/context checkpoint: charts `0939bcc` adds exact plotted-study
identity to the public context event and widget editor. Consumer `5846d7ae9`
installs that exact 33-file package, adds actual price/drawing/study context
actions, persists fired once-only alerts across named workspace reload with
autosave off, and aborts cancelled replay history without accepting late cache
results. Library 5513 tests and example 244 tests pass with full verification;
consumer 2293 tests, build/types, lint and API coverage pass. The consumer passes
46 combined browser checks per engine, 138 total, with inspected desktop/mobile
alert screenshots. Detailed evidence and warnings are in the alert plan. This
is progress toward the existing full scope; reference context parity, endurance,
connected broker and the remaining production/release gates remain open.

Reference context checkpoint: yfinance now offers price, exact study-plot,
drawing and alert-list actions for both charts, with chart/scope ownership
guards. The primary menu also excludes order actions from oscillator panes;
a regression exposed and corrected hidden menu rows being displayed by flex
styling. Five unit and nine cross-browser pointer regressions pass; complete
reference suites pass 249 unit tests and 37 browser tests. Selected editor
screenshots across all three engines were inspected. Repository lint/types and
website build pass, with the existing runner/root warning retained. This change
does not alter the packed library or consumer checkpoint. Sustained endurance,
connected broker, F1-F9/P1-P6 and final release requirements remain in scope.

### Shared consumer toolbar checkpoint

Consumer commit `3972843f7` replaces duplicated pane controls with one workspace
row following the selected chart. Panes retain their terminal and dialog state;
keyboard focus and the chart selector select the same owner. Staging grids never
publish controls, pending controls are inert, fullscreen relocates the selected
controls, and layout changes preserve surviving focus or select a surviving pane.
The selector stays visible during horizontal scrolling. The user guide is updated.

Six new unit regressions and duplicate-toolbar/hidden-selector browser failures
were observed first. Final consumer tests: 2299 in 142 files; build/types and lint
pass with existing notices. Combined browser validation: 59 checks per engine,
177 total. The final selector improvement passes 21 toolbar/baseline checks per
engine, 63 total, with another full consumer test/build run. Screenshots across
all engines were inspected. Detailed evidence and warnings are in the shared
toolbar plan at `2026-09-20-shared-toolbar.md`.

The installed chart package remains `0939bcc`; no published chart API or default
changed. The user confirmed concern for existing portal compatibility: keep shared
replay opt-in and preserve per-chart defaults. The source score remains frozen.
Reference-example toolbar parity is next. Sustained endurance, authenticated broker
checks and all remaining production/release requirements remain open. No release
was published. Original checkout edits were preserved.

### Reference selection and snapshot checkpoint

The reference example now uses explicit pointer/keyboard chart selection and
keeps snapshots bound to their captured chart, symbol and interval. Hover no
longer switches the owner; stale menus are rejected after a rebuild or request
change. The selected border paints above the canvas and is verified with actual
pixels. Snapshot conversion cannot rename an image after the request changes.

Final evidence: 255 example tests in 21 files and 40 reference browser tests pass,
with repository types and lint. Red/green regressions and artifact locations are
recorded in the shared toolbar plan. The existing runner color warning remains.
Remaining reference toolbar routing, F8 shared replay, broader production gates,
endurance, final broker validation and release work remain open. The library and
installed consumer package are unchanged. This is a local development checkpoint;
2.4.5 has not been published and the readiness score remains frozen.

### Reference shared controls and restoration checkpoint

The shared reference toolbar now routes symbol/expression, interval, range,
chart type, P&F mode, studies/settings, grid and reset to its captured selected
chart. Secondary history cancellation is independent, loading/failure cannot
autosave transient state, and alerts stay paused until valid history arrives.
The secondary chart retains its independent type, study identity/settings,
grid and selection through reload. Interval sync is optional and persisted.
Its canvas readout appears in exports and stacks above study legends. Chart 1
retains the reference trading simulation, with disabled Buy/Sell on chart 2.

Browser regressions also fixed secondary viewport broadcasts and primary resize
drift during saved split restoration. Final evidence: 261 example tests/21 files,
49 reference browser tests, types and lint pass. Final screenshots from Chromium,
Firefox and WebKit were inspected. The shared-toolbar plan records red/green
artifacts, resource review and the existing runner color warning. No library API,
packed consumer dependency or consumer source changed in this checkpoint.

Task 2 remains open for settings/readout parity, volume, comparison, replay and
fullscreen ownership. Remaining F/P scope, endurance, final read-only broker
validation and release work still apply. The release sequence is to validate
the packed candidate in /trading, publish 2.4.5, then pin /trading to the published
package and revalidate. Port 5000 has not been switched to the development
worktree. Nothing was published and the frozen score is unchanged.

### Reference settings, readout and volume checkpoint

Chart settings retain their selected owner through edits, Cancel, defaults,
context actions, rebuild and reload. Secondary timezone and calendar aggregation
are independent; confirmation refolds that chart and Cancel preserves its history.
Host-owned candle styles are reapplied on matching-type restore. Both charts now
have persisted volume visibility, candle-colour matching and configurable volume
MA on the same scale, including live tail replacement/append and replay-prefix
isolation. Heikin Ashi retains volume; unsupported price-bucket transforms explain
the unavailable controls. Missing volume and warmup remain gaps.

Additional regressions fixed a future daily-change reading during replay, the
primary transformed close showing raw candles, a fresh split displaying only its
first few bars, and a WebKit colour control displaying clipped hex text.

Final checks: 267 example tests/22 files, 64 reference browser tests, types and
lint pass. Three-engine settings and dark/light chart images were inspected;
browser pixels verify candle-direction colours and the colour swatch. The shared
toolbar plan records full artifacts, resource review and retained runner warning.
No library/package/consumer source changed, and no real orders were sent.

Task 2 still owns reference comparison/replay/fullscreen routing and compact
toolbar/readout polish. Reference F1/F2 restoration remains broader than the
secondary restore tested here, including primary request/type and initial calendar
timezone handling. F8, P1-P6, sustained endurance, final authenticated read-only
broker validation, whole-branch review and release/publication remain open.
The consumer stays at 3972843f7 with the 0939bcc candidate; 2.4.5 is unpublished.

## Release sequencing correction, 2026-09-20

The user explicitly requests publishing Charts 2.4.5 before completing the
remaining OpenAlgo /trading changes. This supersedes the earlier candidate-first
consumer release gate. Finish the chart package scope, reference example checks,
package/API compatibility checks, documentation and chart release review; then
publish npm, website and GitHub release. Complete and validate the remaining
/trading implementation against the published package afterwards. Do not make
new consumer feature work or its final connected-broker/deployment validation a
prerequisite for publishing Charts. Preserve the existing consumer worktree.
This changes sequencing, not an authorization to publish known chart defects or
a statement that the unfinished chart scope is complete. The previous 20-30
working-hour estimate covered both projects. No new release-time estimate has
been verified for the chart-only scope.

### Reference comparison checkpoint

Both reference charts retain their own comparison sources, hidden state and
scale modes through focus changes, type rebuilds and reload. Requests capture
their chart/interval/range/timezone and stale or removed results are discarded.
Source errors clear old prices and provide Retry. Removing the last comparison
restores the pre-comparison mode after rebuild. 278 example tests, 70 reference
browser cases, types and lint pass; a final style follow-up passes six focused
three-engine cases with a narrow error/retry layout. Screenshots were inspected.
Artifacts and remaining work are in the shared toolbar plan. F7 baseline/live/
replay engine work is still open; this checkpoint only completes host ownership.
No engine API or consumer dependency changed, and 2.4.5 remains unpublished.
The updated sequence is Charts publication first, remaining /trading work after.

### Comparison engine and common-start checkpoint

Comparisons now own independent scales and an optional common visible timestamp.
The legacy first-visible default remains; the reference host opts into common
mode and clears lines and legend readings when no shared start exists. The new
barAt readout withholds forming replay closes. History replacement with a fixed
global axis, live updates, replay start/seek/stop, sources added during replay,
inversion, manual ranges and chart-first cleanup are covered. Named hidden scales
release after their last series. Public docs and examples describe the contracts.

Package verification passes: 5531 engine tests/230 files, 278 example tests/23
files, types, lint, build, declarations, size and shake. The final host correction
passes the 278 example tests and 73 reference browser cases. API generation,
917-entry skills coverage and website build pass. The comparison-scales plan
records regressions, screenshot review, bundle impact and resource limits.

This is a local chart checkpoint. Broader F/P scope, sustained endurance, final
review and publication remain open; remaining /trading implementation and final
broker/deployment validation follow Charts 2.4.5 publication. No consumer package
or source changed here, and the score remains frozen.

### Reference replay and fullscreen ownership checkpoint

Focused replay retains its captured chart across focus changes and unrelated
chart rebuilds. Finer history and time formatting use its captured request and
timezone. Picker/transport/exit UI stays with that chart, pending responses cannot
survive owner closure, and direct chart destruction stops the playback clock.
Both charts' alert evaluation and every order-entry route remain guarded.
Fullscreen shows the selected chart while retaining shared controls and dialogs;
switching its selected chart works, and removing that owner restores the workspace.
Narrow transport wraps, and the toolbar's chart selector stays visible while scrolling.

Final verification: 280 example tests/23 files, 85 reference browser cases in three
engines, types and lint pass. Three additional fullscreen geometry checks pass.
Screenshots were inspected and retained; the shared-toolbar plan records red/green
evidence, resource review and browser capture limits. Compact canvas-readout polish
remains, along with F8, reference F1/F2, remaining production gates, endurance,
whole-branch review and publication. No library or consumer source changed.
Charts 2.4.5 still publishes before the remaining /trading work and final broker
validation. Nothing was pushed or published and the score remains frozen.

### Compact readouts and F9 checkpoint

Canvas legends now fit whole readings and hover actions inside their plots.
Long titles shorten, optional priority retains useful readings first, and resize
restores all stored fields. The reference gives close prices priority. Clipped
rows cannot intercept axis clicks. Public and example docs describe the behavior.
The focused toolbar audit and compact browser evidence complete Task 2/F9;
shared-clock replay is still the separate F8 requirement.

Final package verification passes: 5538 engine tests/231 files, 280 example
tests/23 files, lint/types/build/declarations/size/shake. All 90 reference and SVG
browser cases pass; compact screenshots were inspected in three engines. API
generation, 917-entry skills coverage and the website build pass. The shared-toolbar plan records
regression evidence, corrected test assumptions, Firefox navigation limits,
resource review and the measured 0.39 KiB base-bundle increase.

Remaining chart work: F8, reference F1/F2, remaining production contracts,
endurance, whole-branch review and release facts/version/publication. Existing
consumer work remains preserved and its remaining implementation and final
connected-broker/deployment checks follow Charts 2.4.5 publication. Score frozen.
