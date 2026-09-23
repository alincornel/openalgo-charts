# Compatibility and maintenance

This page describes the public integration contract and release expectations.
It is not a service agreement or a guarantee of market-data or broker availability.
Security reports and supported fix branches follow [SECURITY.md](SECURITY.md).

## Public API and versions

Use the package's documented export entries and exported TypeScript declarations.
Deep imports into source files, generated bundle internals, underscored members,
demo globals and widget CSS/DOM structure are not stable extension points. The
widget owns its markup; hosts needing different chrome can use the headless APIs.
Descriptor hooks and registered extensions are public only where documented.

Within a major version, existing public options retain their defaults and new
features should be additive. Mark an API deprecated in its declaration and
documentation, provide the replacement and migration example, and keep the old
entry until the next major release. Numeric correctness, data ownership and
security fixes can change incorrect behavior within a patch; explain affected
inputs and the resulting behavior in release notes instead of silently preserving
a defect. Experimental or host-specific examples do not imply a permanent API.

Saved chart, drawing, alert and workspace formats have their own version fields.
Do not rewrite them to the package version. Use their public validation/restore
APIs and inspect failures or partial-restore reports. Preserve the last good stored
document when a migration fails. Broker orders, positions, credentials and armed
state do not belong in portable layout files.

## Runtime boundary

The published package is ESM with a standalone browser bundle and no runtime
dependencies. The build toolchain requires Node.js 20 or later, as declared in
`package.json`. Construct charts only where the required browser canvas/DOM APIs
exist; rendering on a server needs a host-owned environment and is not implied by
successful server-side module resolution.

Browser regression projects exercise Chromium, Firefox and WebKit. Record actual
versions, operating system, viewport, device-pixel ratio and rendering backend with
release evidence. WebKit automation does not prove every Safari/device combination.
Canvas2D is the general rendering path; WebGL2 accelerates supported series and
retains the documented fallback. Clipboard, fullscreen and downloads also depend
on browser permissions and embedding policy. Surface those failures to the user.

## Host and adapter responsibility

The host supplies authenticated transport, current instrument/session metadata,
provider timestamp conversion, symbol resolution, supported intervals, cancellation
and persistence namespaces. Read [instrument rules](docs/instruments.md),
[adapter conformance](docs/adapter-conformance.md) and the integration API reference.
OI capability is separate from a missing or zero reading. Alert evaluation happens
in the chart; durable background scheduling and notification delivery belong to
the host. A closed browser is not a server-side alert service.

Broker state remains authoritative for execution, risk and permissions. Chart
capability checks and quantity validation improve interaction but do not replace
server enforcement. Reconcile ambiguous results with the broker rather than
assuming a rejected network request means no order exists. Replay and selection
must lock every host order-entry route, including controls outside the chart.

## Upgrade and release evidence

Pin the version used by a financial portal. Test an upgrade in its real host before
rolling it out: source changes and reconnects, layout migration, multiple panes,
drawings/studies, replay, OI gaps and all enabled trading routes. Keep the prior
application deployment available for rollback; never replace an immutable package
version with different files. Downgrading does not guarantee that newer saved
documents can be read by an older host.

Release evidence separates unit tests, deterministic adapter/browser fixtures,
endurance workloads and connected-provider observations. A synthetic feed passing
conformance is not a broker certification. Report the workload and machine for
performance results, and retain failing reports alongside corrected runs. See
[browser endurance](docs/browser-endurance.md) for reproducible measurements.

Prepare release notes, migration guidance, measured package facts, generated API
docs and the website before publishing. Publish the verified immutable tag through
the release workflow, verify npm provenance and package contents, and check the
deployed website independently. [CONTRIBUTING.md](CONTRIBUTING.md) lists the gates.

## Reporting and support

For ordinary defects, open a repository issue with package and host versions,
browser/OS, affected public API, expected/actual behavior and a minimal synthetic
reproduction. Include sanitized logs or screenshots when useful. Report security
issues through the private channel in the security policy. Do not attach account
credentials or private order history to a public issue.

Community maintenance does not promise continuous exchange coverage, a response
SLA, compatibility with every embedding framework or indefinite support for older
minor versions. Provider changes and production operations remain responsibilities
of the adopting host. Any additional support arrangement must be agreed separately.
