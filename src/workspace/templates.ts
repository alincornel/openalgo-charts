import type { IndicatorState } from 'openalgo-charts';
import { parseIndicatorStates } from './documents';
import { WorkspaceDocumentError } from './json';

export type IndicatorTemplateMode = 'replace' | 'append';

/**
 * Validate and detach a study plan before the host changes a chart. Append keeps
 * current instance identities and places positive incoming pane groups after the
 * existing panes; pane zero remains the price pane. Copied studies have no identity.
 * Pass the chart's pane count as nextPaneIndex. This function creates no chart or UI.
 */
export function planIndicatorTemplate(
  current: IndicatorState[], incoming: IndicatorState[], mode: IndicatorTemplateMode,
  available: ReadonlySet<string>, nextPaneIndex: number,
): IndicatorState[] {
  if (mode !== 'replace' && mode !== 'append') throw new WorkspaceDocumentError('Unsupported indicator template mode');
  const previous = parseIndicatorStates(current);
  const additions = parseIndicatorStates(incoming);
  // Templates copy settings; existing alerts must keep their original anchors.
  for (const item of additions) delete item.instanceId;
  if (mode === 'append') {
    const lastOccupied = Math.max(0, ...previous.map(item => item.paneIndex));
    if (!Number.isInteger(nextPaneIndex) || nextPaneIndex <= lastOccupied || nextPaneIndex > 32) {
      throw new WorkspaceDocumentError('Invalid next indicator pane');
    }
    const groups = [...new Set(additions.map(item => item.paneIndex).filter(index => index > 0))].sort((a, b) => a - b);
    for (const item of additions) {
      if (item.paneIndex > 0) item.paneIndex = nextPaneIndex + groups.indexOf(item.paneIndex);
      if (item.paneIndex > 31) throw new WorkspaceDocumentError('Indicator pane limit exceeded');
    }
  }
  const planned = mode === 'replace' ? additions : [...previous, ...additions];
  if (planned.length > 256) throw new WorkspaceDocumentError('At most 256 indicator instances are supported');
  const missing = [...new Set(planned.filter(item => !available.has(item.indicatorId)).map(item => item.indicatorId))];
  if (missing.length) throw new WorkspaceDocumentError(`Missing indicators: ${missing.join(', ')}`);
  return planned;
}
