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

### Final release version

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
