/** Optional, DOM-free named workspace and indicator-template contracts. */
export {
  WORKSPACE_VERSION, WorkspaceDocumentError, parseWorkspaceDocument, parseWorkspacePayload,
  parseIndicatorTemplate, parseIndicatorStates, migrateWidgetWorkspace,
} from './documents';
export { WorkspaceRepository, WorkspaceConflictError, parseWorkspaceCatalog } from './repository';
export type { WorkspaceCatalog, WorkspaceStorage, WorkspaceRepositoryOptions, WorkspaceOperationOptions, WorkspaceOpenOptions } from './repository';
export { createIndexedDbWorkspaceStorage } from './indexed-db';
export type { IndexedDbWorkspaceStorage } from './indexed-db';
export { planIndicatorTemplate } from './templates';
export type { IndicatorTemplateMode } from './templates';
export type {
  WorkspaceKind, WorkspaceSettings, WorkspaceChartState, WorkspaceComparison, WorkspaceSlot, WorkspacePane,
  WorkspacePayload, WorkspaceDocument, IndicatorTemplateDocument,
} from './documents';
