# Workspace tier

Use the optional `openalgo-charts/workspace` entry point for named configurations.
It is DOM-free, registers nothing and imports shared chart types from the base
entry. See [the host integration guide](../../../../docs/workspaces.md) for a
complete example, limits, restore ownership and account-switch requirements.

Runtime exports:

- `WORKSPACE_VERSION`: document schema version `1`.
- `parseWorkspaceDocument`, `parseWorkspacePayload`: validate/detach independent
  panes, grid slots, focus and crosshair/viewport/symbol/interval sync settings.
  Optional layout `rowWeights`/`columnWeights` preserve unequal tracks: positive
  finite values up to 1,000, one per track. Missing lists mean equal tracks.
- `parseIndicatorTemplate`, `parseIndicatorStates`: retain duplicate instances,
  settings, visibility, pane placement and unavailable custom IDs. Empty is valid.
- `migrateWidgetWorkspace`: explicit single-widget version-1 migration; metadata
  is supplied by the host, bars and execution state are excluded.
- `WorkspaceDocumentError`: malformed/unsupported/oversized input.
- `parseWorkspaceCatalog`: validate the entire persisted catalog before mutation.
- `WorkspaceRepository`: asynchronous `load`, `createWorkspace`, `saveWorkspace`,
  `createTemplate`, `rename`, `duplicate`, `remove`, `openWorkspace`, `setAutosave`,
  `importDocument`, `exportDocument`; immutable `namespace`; optional `now`/`id`.
- `WorkspaceConflictError`: a saved revision changed; reload before retrying.
- `createIndexedDbWorkspaceStorage`: explicit `IDBFactory`, optional database name,
  atomic revision checks across tabs. `close()` releases the connection. Database
  version changes close it automatically; construct a new adapter afterward.

Types: `WorkspaceKind`, `WorkspaceSettings`, `WorkspaceChartState`,
`WorkspaceComparison`, `WorkspaceSlot`, `WorkspacePane`, `WorkspacePayload`,
`WorkspaceDocument`, `IndicatorTemplateDocument`, `WorkspaceCatalog`,
`WorkspaceStorage`, `WorkspaceRepositoryOptions`, `IndexedDbWorkspaceStorage`.

`WorkspaceStorage.write(namespace, catalog, expectedRevision)` MUST compare and
write atomically. A read/then-write localStorage adapter does not meet this
contract. The IndexedDB adapter resolves writes on transaction completion and
rejects stale/corrupt revisions; custom server adapters must do the equivalent.

Hosts provide controls and application semantics. `openWorkspace` records catalog
selection and returns a document; it does not load charts. `setAutosave` saves a
preference, not a timer. Template application must check custom-study availability
before replacement. Use a new repository per account and keep completion callbacks
bound to their original owner. Show a save error when storage rejects.

Metadata is epoch milliseconds; chart/drawing times stay UTC seconds. Import
always creates a fresh document ID. Never include credentials or trading execution
state. Reserved keys are filtered, but arbitrary free text is not secret-scanned.
Do not execute imported text or assume namespace names provide authorization.
