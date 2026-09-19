# Open interest implementation plan

> Use superpowers:executing-plans with the user's continuous native execution authorization. Preserve the original checkout and validate each boundary before committing.

**Goal:** Carry optional per-bar open interest through the engine and supported hosts, with three useful studies and an honest availability/readout contract.

**Architecture:** Reuse the supplied eight-file plumbing patch, then complete every data path that copies or aggregates bars. Keep indicators in their existing lazy tier. Instrument capability belongs in chart data context; missing observations remain missing even for a capable instrument.

**Tech stack:** TypeScript, Vitest, existing canvas engine, browser compatibility harness and OpenAlgo React host. No runtime dependencies.

**Spec:** `../specs/2026-09-20-open-interest-and-alerts-requirements.md`, Part 1. Part 2 remains a separate required subsystem, followed by the remaining production matrix and authorized 2.4.5 release.

## Constraints and integration decisions

- `Bar.oi?: number` is a level. Historical folds carry the latest defined reading within their bucket, never a sum, and never carry between buckets. Zero remains zero.
- A current tick with no open-interest reading leaves the forming bar's open interest absent. Do not silently retain a seeded historical level or the previous tick's level as current data.
- Heikin Ashi keeps the column because it maps one source row to one output row. Price-generated transforms and expression results omit it, including expression results that opt into combined volume.
- Historical replay may use only readings already revealed by its sub-bar playhead. Reconciliation must not restore a stale history reading over a newer live observation that lacks open interest.
- Expose an optional instrument `hasOpenInterest` capability in chart data context. Explicit false means unsupported; absent means unknown. A zero observation is never evidence of unsupported data. Document the chart-side access contract for the language host separately from per-bar `oi`.
- New status-line open interest is off by default. Unsupported instruments expose a disabled setting with a reason and no readout.
- Preserve the excluded-name, plain-text, tier, teardown and bundle-budget rules from CLAUDE.md. No live orders.

## Review focus

- A history-seeded forming bar receives a quote without open interest: it must not appear current merely because the old object still owns `oi`.
- A live update arrives while REST reconciliation is pending: older history must not manufacture a current level.
- Mixed missing and zero readings: folds must not cross bucket boundaries, indicators must not bridge absent source observations, and capability must not be inferred from zero.
- Replay shows a partial higher-timeframe bar: the completed bar's open interest must remain hidden until its corresponding observation is revealed.
- A workspace changes from a contract to an unsupported cash instrument: availability, settings and readout must follow the new context without deleting saved preferences.

## Task 1: Validate and import the supplied plumbing

Files: the eight paths in the supplied patch; create `tests/open-interest-data.test.ts`.

- [ ] Write tests for `mergeBars` returning 140 from readings 100, 110, 120, 130, 140 while volume sums; test the same completed and developing `securitySeries` buckets.
- [ ] Cover empty buckets, zero, missing readings, REST mapping, candle and tick aggregation, one-to-one transform retention and every synthetic transform's omission. Run `npx vitest run tests/open-interest-data.test.ts`; observe the missing plumbing failures.
- [ ] Apply `D:/OpenAlgo-Voice/codex instruction/openalgo-charts-oi-plumbing.patch` only in this worktree after `git apply --check`. The original main checkout remains untouched.
- [ ] Verify the imported implementation, then add regressions for unsupported/missing live readings and nonfinite optional REST values before correcting those paths. Run affected feed, security, transform and conflation suites.

## Task 2: Replay, cache and reconciliation boundaries

Files: `src/replay/controller.ts`, `src/feed/data-controller.ts`, `src/feed/cache.ts`; extend the relevant replay, data-controller and cache regressions.

- [ ] With a deferred REST request, deliver a live observation lacking open interest and verify the resolved historical snapshot cannot put the old level back. Also test a genuine live reading, including zero.
- [ ] Build a partial replay bucket whose completed level is 140 and first sub-bar level is 100; verify the first replay frame reads 100 and never 140, then walk the remaining readings and a missing bucket.
- [ ] Inject persisted nonfinite open interest and verify cache fallback without a fabricated zero. Round-trip valid optional levels through cold storage.
- [ ] Implement only the missing propagation/validation. Run the full affected data/replay/cache suites and commit the verified data boundary.

## Task 3: Three built-in studies

Create `src/indicators/open-interest.ts` and `tests/indicator-open-interest.test.ts`; wire the existing indicators entry/registry.

- [ ] Raw Open Interest is a pane line with volume price formatting and null gaps.
- [ ] Open Interest Change is a pane histogram of adjacent readings, null on the first bar or either missing side, with up/down colors and generated plot styling.
- [ ] Open Interest Buildup paints candles using close-to-close price change and open-interest change. Four configurable colors identify long buildup, short buildup, short covering and long unwinding. The unchanged selector defaults to neutral; its up mode treats zero change as nonnegative. Missing inputs always remain neutral.
- [ ] Test all four signs, unchanged behavior, missing/zero, warmup, style input generation, source replacement and live updates. Observe failures, implement, run indicator integration suites and inspect actual browser pixels.

## Task 4: Capability and status line

Files: `src/model/indicator-registry.ts`, `src/core/chart.ts`, `src/primitives/pane-legend.ts`, `src/model/chart-settings.ts` and their existing tests.

- [ ] Add capability regressions for explicit supported, unsupported and unknown context. Distinguish capability from whether the current bar has a reading.
- [ ] Add an off-by-default open-interest legend field and setting. Show zero when supplied, omit missing and unsupported data, and preserve the preference through chart state and workspace restoration.
- [ ] Thread metadata and render actual hovered/current-bar values. Verify state round trips, context changes and disabled-control feedback in browser pixels.
- [ ] Document the exact typed chart contract consumed by OpenScript; do not modify that separate project's files.

## Task 5: Hosts and documentation

Files: reference host, widget, OpenAlgo terminal history/legend path, README, indicator catalogue, architecture data-model section, API/skills references and release notes.

- [ ] Preserve real derivatives OI from OpenAlgo history, omit unsupported instrument values using explicit host metadata, and keep quote-only forming readings absent. Display availability and user-selected readouts consistently in widget, reference host and `/trading`.
- [ ] Exercise futures history, zero, cash, missing live OI, symbol changes, study templates and complete workspaces against the installed packed candidate. Run Chromium, Firefox and WebKit and label deterministic versus real-feed evidence.
- [ ] Document level versus flow, missing versus zero, the live gap, indicator behavior and host capability. Measure registry counts, API coverage and bundle sizes; update repeated current facts at final release.
- [ ] Run full library verification, skills coverage, warning-free API generation and affected host checks. Commit locally and retain all alert and remaining production requirements in the master ledger.
