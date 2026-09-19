# Named workspaces and indicator templates

The optional `openalgo-charts/workspace` entry point provides portable configuration
documents, a catalog repository and an IndexedDB storage adapter. It creates no UI,
chart or market-data subscription. Hosts own their layout controls, data loading,
template application and save notifications.

```ts
import {
  WorkspaceRepository, createIndexedDbWorkspaceStorage,
  parseWorkspacePayload, parseWorkspaceDocument,
} from 'openalgo-charts/workspace';

// Browser initialization. Use an opaque namespace for the authenticated user.
const storage = createIndexedDbWorkspaceStorage(window.indexedDB);
const repository = new WorkspaceRepository(storage, 'user-42');
const payload = parseWorkspacePayload({
  layout: {
    rows: 1, columns: 1,
    slots: [{ paneId: 'p0', row: 0, column: 0, rowSpan: 1, columnSpan: 1 }],
  },
  panes: [{
    id: 'p0', symbol: 'RELIANCE', exchange: 'NSE', interval: '5m',
    chartType: 'candlestick', chart: chart.getState(),
    settings: {}, volume: true, magnet: 'off', stay: false,
    comparisons: [], comparisonMode: 'percent',
  }],
  activePaneId: 'p0',
  sync: { crosshair: true, viewport: true, symbol: false, interval: false },
});

const saved = await repository.createWorkspace('Morning desk', payload);
await repository.openWorkspace(saved.id);
// Capture fresh host state before saving again.
await repository.saveWorkspace(saved.id, {
  ...payload,
  panes: [{ ...payload.panes[0], chart: chart.getState() }],
});
await repository.createTemplate('My studies', chart.getState().indicators ?? []);

const exported = await repository.exportDocument('workspace', saved.id);
const checked = parseWorkspaceDocument(exported);
const imported = await repository.importDocument(checked); // always a new ID
console.log(imported.id, (await repository.load()).recentWorkspaceIds);

// At host disposal, release the browser database connection.
await storage.close();
```

## Portable documents

`WORKSPACE_VERSION` is `1`. `parseWorkspaceDocument`, `parseWorkspacePayload`,
`parseIndicatorTemplate` and `parseIndicatorStates` accept unknown input, detach
the supported configuration and reject malformed documents with
`WorkspaceDocumentError`. JSON text is accepted for complete documents and arrays.
Unsupported versions are rejected before a host changes its charts.

`WorkspaceDocument` adds `kind`, `version`, `id`, `name`, `createdAt` and `updatedAt`
to a `WorkspacePayload`. Metadata timestamps are epoch **milliseconds**. Bar and
drawing times retain the engine's UTC **seconds** convention.

A payload contains a grid, independent panes, the focused pane ID and four sync
preferences. Slots use zero-based row/column coordinates with positive spans.
Optional `layout.rowWeights` and `layout.columnWeights` preserve unequal track
sizes, such as `[1.4, 1]` for a wider left column. Each list must match its row or
column count and contain positive finite numbers no greater than 1,000. Omitted
lists mean equal tracks. Hosts render these as relative fractions; a preset name
does not override explicit geometry or weights.
Each pane retains its instrument, interval, chart type, chart snapshot, host
settings, volume preference, drawing magnet/stay preference, comparison definitions
and optional `historyPeriod`. `WorkspaceChartState` preserves `ChartState`,
`ChartSettingsState` and timezone, including drawings, repeated indicators,
indicator styles/visibility/pane placement, price scales and viewport.

`WorkspaceSettings` is a flat map of string, finite-number or boolean values.
Use namespaced host keys such as `volume.maPeriod`; do not put account data there.
Comparisons carry stable IDs, symbols, exchanges, optional colors and visibility.
Neither primary bars nor comparison bars belong in these documents.

Indicator templates contain `IndicatorState[]`. Repeated descriptor IDs are
separate instances. Empty templates are valid. Unknown custom descriptor IDs are
retained so an export does not destroy configuration from another installation.
The applying host must load/register required studies, check availability and
report missing studies before replacing the current set. The repository does not
apply a template to a chart or choose append versus replace.

### Limits and excluded data

- Up to 16 charts, grid dimensions up to 8 by 8, exactly one non-overlapping slot
  per pane and a valid focused pane.
- Up to 256 study instances, 32 comparison definitions per chart, 32 internal
  chart panes and 512 series style descriptors.
- Document names of 1–120 characters; document IDs of 1–100 characters.
- At most 5 MiB of UTF-8 JSON, depth 32 and 100,000 JSON nodes. The complete
  catalog is subject to the same total size limit.
- No accessors, executable functions, cycles, class instances or non-finite
  numbers. The parser projects recognized document/chart fields and removes
  reserved credential and execution keys from nested records.

Credentials, account balances, orders, positions and an armed trading state are
not workspace data. The reserved-key filter is defense in depth, not a secret
scanner: arbitrary drawing text and custom study values are user data. Hosts
must never insert secrets into those values. Keep trade execution state in a
separate store and disarm on workspace restoration. Treat imported text as text,
not HTML or executable expressions. Parsing is a data validation boundary, not
a sandbox for hostile JavaScript objects such as proxies.

## Catalog transactions and storage

`WorkspaceRepository` supports `load`, `createWorkspace`, `saveWorkspace`,
`createTemplate`, `rename`, `duplicate`, `remove`, `openWorkspace`, `setAutosave`,
`importDocument` and `exportDocument`. The `namespace` getter is immutable.
Constructor options can supply `now` and `id` factories; the defaults are
`Date.now` and `crypto.randomUUID`.

The catalog permits 100 workspaces, 100 templates and 10 unique recent workspace
IDs. Creating or importing does not open a workspace. `openWorkspace` records
the active document and moves it to the front of the recent list; it returns the
document for the host to restore. Deleting the active workspace chooses the
newest remaining recent ID or null. Duplicate/import create fresh identities
and metadata timestamps, leaving the original intact.

Each repository serializes mutations and reads the latest stored catalog before
every mutation. A mutation increments `revision` once and reports success only
after storage resolves. A rejected write leaves the existing saved catalog
intact, rejects to the caller and does not poison the queue. Invalid stored
catalogs are reported, never replaced with an empty catalog.

`setAutosave` stores a preference. Hosts must debounce actual saves, suppress
them during restoration and replay, cancel pending timers on account changes,
and show success only after the returned promise resolves. Use a new repository
when the authenticated account changes. An in-flight save remains bound to the
old repository's namespace; guard completion notifications against stale owners.

`createIndexedDbWorkspaceStorage(indexedDB, databaseName?)` stores a catalog per
namespace in the `catalogs` object store. It compares and writes revisions in
one readwrite transaction, including across browser tabs. `close()` releases its
connection and rejects new work; existing transactions may finish. A database
version change closes the adapter automatically. Create a new adapter afterward.
Blocked opens, quota errors and aborted transactions reject to the host, with no
silent localStorage or memory fallback.

Server persistence uses the same `WorkspaceStorage` interface:

```ts
interface WorkspaceStorage {
  read(namespace: string): Promise<unknown | null>;
  write(namespace: string, catalog: WorkspaceCatalog,
        expectedRevision: number): Promise<void>;
}
```

The adapter must compare the current revision and write **atomically**, rejecting
stale writes with `WorkspaceConflictError`. A localStorage get/set pair is not
atomic across tabs. For remote persistence, authorize the namespace server-side
and use a database transaction or conditional version update. Namespace separation
alone is not authorization. After a conflict, reload and let the user decide
whether to retry; do not silently overwrite another session's changes.

## Migration and restoration

`migrateWidgetWorkspace(widgetState, { id, name, now })` converts the existing
version-1 single-widget envelope into a one-pane workspace. It retains the chart
snapshot, instrument, interval, chart type, theme (`settings['widget.theme']`)
and magnet/stay preferences. Widget rail favorites and last-used tool choices
remain application preferences. This function does not migrate a host's other
storage schemas or delete the old entry.

Before restoration, validate the document and host capabilities: grid capacity,
supported intervals/chart types, custom studies and comparison support. Obtain
fresh market data from the host's adapter and restore configuration only after
the appropriate series exist. Apply focused pane and sync settings deliberately;
never let construction-time synchronization overwrite independently saved panes.
Keep the previous workspace recoverable if loading fails, and hold trading
disabled throughout the transition. Loading a layout must not import orders,
positions, API keys or an armed flag.
