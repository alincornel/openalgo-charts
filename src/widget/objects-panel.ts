import { widgetText } from './localization';
import type { ChartObjects, ChartObjectSnapshot } from 'openalgo-charts';
import type { WidgetContext } from './context';
import { button, dialogFrame, el, openPanel, type PanelHandle } from './form';

export interface ObjectsPanelOptions {
  /** Overrides the widget's inventory for a custom host. The caller owns it. */
  objects?: ChartObjects;
  /** Runs once for either programmatic or overlay dismissal. */
  onClose?: () => void;
}

type Action = keyof ChartObjectSnapshot['capabilities'];
interface ObjectRow {
  el: HTMLElement;
  summary: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
  status: HTMLElement;
  actions: HTMLElement;
  selectable: boolean;
  buttons: Map<Action, HTMLButtonElement>;
}

const KINDS = { source: 'Source', indicator: 'Indicator', drawing: 'Drawing', profile: 'Profile' };
const ACTIONS = ['visibility', 'lock', 'settings', 'focus', 'remove'] as const;
const STATUS = { loading: 'Loading', ready: 'Ready', empty: 'No data', unsupported: 'Unsupported', error: 'Could not load' };
const FAILURES = { select: 'Could not select {name}', visibility: 'Could not change visibility for {name}', lock: 'Could not change lock for {name}', settings: 'Could not open settings for {name}', focus: 'Could not focus {name}', remove: 'Could not remove {name}' } as const;

let rowSequence = 0;

/** Open a searchable inventory backed by the host's live object model. */
export function mountObjectsPanel(
  ctx: WidgetContext, anchor?: HTMLElement, opts: ObjectsPanelOptions = {},
): PanelHandle {
  const resolved = opts.objects ?? ctx.objects;
  if (resolved === undefined) throw new Error(widgetText(ctx, 'Objects panel requires an object model'));
  const objects = resolved;
  const paneLabel = (row: ChartObjectSnapshot): string => widgetText(ctx, 'Pane {number}', { number: row.paneIndex + 1 });
  const kindLabel = (row: ChartObjectSnapshot): string => widgetText(ctx, `schema.object.kind.${row.kind}`, {}, KINDS[row.kind]);
  const doc = ctx.document;
  let closed = false;
  let all: readonly ChartObjectSnapshot[] = [];
  const rows = new Map<string, ObjectRow>();

  const frame = dialogFrame(doc, { translate: ctx.translate, title: widgetText(ctx, 'Objects'), className: 'oac-objects', onClose: () => handle.close() });
  frame.closeButton.textContent = widgetText(ctx, 'Close');
  frame.closeButton.classList.remove('oac-btn--icon');
  const search = el(doc, 'input', 'oac-objects__find');
  search.type = 'search';
  search.placeholder = widgetText(ctx, 'Search name, type or pane');
  search.setAttribute('aria-label', widgetText(ctx, 'Search objects'));
  search.setAttribute('spellcheck', 'false');
  const list = el(doc, 'div', 'oac-objects__list');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', widgetText(ctx, 'Chart objects'));
  const empty = el(doc, 'div', 'oac-empty');
  empty.setAttribute('role', 'status');
  const count = el(doc, 'span', 'oac-objects__count');
  count.setAttribute('role', 'status');
  frame.body.append(search, list, empty);
  frame.lead.appendChild(count);
  frame.actions.appendChild(button(doc, { label: widgetText(ctx, 'Done'), variant: 'primary', onClick: () => handle.close() }));

  function act(action: Action, id: string, event?: MouseEvent): void {
    if (closed) return;
    const item = objects.get(id);
    let success = false;
    try {
      if (item?.capabilities[action]) {
        switch (action) {
          case 'select': success = objects.select(id, event?.ctrlKey === true || event?.metaKey === true); break;
          case 'visibility': success = objects.setVisible(id, !item.visible); break;
          case 'lock': success = objects.setLocked(id, !item.locked); break;
          case 'settings': success = objects.openSettings(id); break;
          case 'focus': success = objects.focus(id); break;
          case 'remove': success = objects.remove(id); break;
        }
      }
    } catch { /* A host provider can reject an action without changing its object. */ }
    if (!success) ctx.toast(widgetText(ctx, FAILURES[action], { name: item?.name ?? widgetText(ctx, 'object') }), 'error');
  }

  function makeRow(item: ChartObjectSnapshot): ObjectRow {
    const node = el(doc, 'div', 'oac-objects__row');
    node.dataset.objectId = item.id;
    node.setAttribute('role', 'listitem');
    const summary = item.capabilities.select
      ? button(doc, { label: '', onClick: event => act('select', item.id, event) })
      : el(doc, 'div');
    summary.classList.add('oac-objects__summary');
    if (item.capabilities.select) summary.dataset.action = 'select';
    const name = el(doc, 'span', 'oac-objects__name');
    const meta = el(doc, 'span', 'oac-objects__meta');
    const status = el(doc, 'span', 'oac-objects__status');
    const identity = `oac-object-${++rowSequence}`;
    meta.id = `${identity}-meta`;
    status.id = `${identity}-status`;
    if (item.capabilities.select) summary.setAttribute('aria-describedby', `${meta.id} ${status.id}`);
    summary.append(name, meta, status);
    const actions = el(doc, 'div', 'oac-objects__actions');
    node.append(summary, actions);
    return { el: node, summary, name, meta, status, actions, selectable: item.capabilities.select, buttons: new Map() };
  }

  function updateRow(row: ObjectRow, item: ChartObjectSnapshot): void {
    row.name.textContent = item.name;
    const meta = [kindLabel(item), paneLabel(item), item.visible ? widgetText(ctx, 'Visible') : widgetText(ctx, 'Hidden')];
    if (item.locked !== undefined) meta.push(item.locked ? widgetText(ctx, 'Locked') : widgetText(ctx, 'Unlocked'));
    if (item.selected) meta.push(widgetText(ctx, 'Selected'));
    row.meta.textContent = meta.join(', ');
    row.el.classList.toggle('is-selected', item.selected);
    if (row.selectable) {
      row.summary.setAttribute('aria-label', widgetText(ctx, 'Select {name}', { name: item.name }));
      row.summary.setAttribute('aria-pressed', String(item.selected));
    }
    row.status.textContent = item.dataStatus === undefined ? '' : widgetText(ctx, `schema.dataStatus.${item.dataStatus.state}`, {}, STATUS[item.dataStatus.state]);
    row.status.hidden = item.dataStatus === undefined;
    row.status.dataset.state = item.dataStatus?.state ?? '';

    let index = 0;
    for (const action of ACTIONS) {
      let control = row.buttons.get(action);
      if (!item.capabilities[action]) {
        control?.remove();
        row.buttons.delete(action);
        continue;
      }
      if (control === undefined) {
        control = button(doc, { label: '', variant: action === 'remove' ? 'danger' : 'ghost', onClick: () => act(action, item.id) });
        control.dataset.action = action;
        row.buttons.set(action, control);
      }
      const label = action === 'visibility' ? (item.visible ? widgetText(ctx, 'Hide') : widgetText(ctx, 'Show'))
        : action === 'lock' ? (item.locked ? widgetText(ctx, 'Unlock') : widgetText(ctx, 'Lock'))
          : action === 'settings' ? widgetText(ctx, 'Settings') : action === 'focus' ? widgetText(ctx, 'Focus') : widgetText(ctx, 'Remove');
      control.textContent = label;
      control.setAttribute('aria-label', widgetText(ctx, action === 'visibility' ? (item.visible ? 'Hide {name}' : 'Show {name}') : action === 'lock' ? (item.locked ? 'Unlock {name}' : 'Lock {name}') : action === 'settings' ? 'Settings for {name}' : action === 'focus' ? 'Focus {name}' : 'Remove {name}', { name: item.name }));
      if (row.actions.children[index] !== control) row.actions.insertBefore(control, row.actions.children[index] ?? null);
      index++;
    }
    row.actions.hidden = index === 0;
  }

  function paint(): void {
    if (closed) return;
    const query = search.value.trim().toLowerCase();
    const shown = all.filter(item => `${item.name} ${kindLabel(item)} ${paneLabel(item)}`.toLowerCase().includes(query));
    const kept = new Set(shown.map(item => item.id));
    const focused = doc.activeElement as HTMLElement | null;
    const heldFocus = focused !== null && list.contains(focused);
    for (const [id, row] of rows) {
      if (kept.has(id)) continue;
      row.el.remove();
      rows.delete(id);
    }
    shown.forEach((item, index) => {
      let row = rows.get(item.id);
      if (row === undefined || row.selectable !== item.capabilities.select) {
        row?.el.remove();
        row = makeRow(item);
        rows.set(item.id, row);
      }
      updateRow(row, item);
      // Leave stable rows attached so canvas selection and live data updates
      // cannot interrupt a user typing or tabbing through object actions.
      if (list.children[index] !== row.el) list.insertBefore(row.el, list.children[index] ?? null);
    });
    empty.hidden = shown.length > 0;
    empty.textContent = all.length === 0 ? widgetText(ctx, 'No objects on this chart.') : widgetText(ctx, 'No objects match your search.');
    count.textContent = query === '' ? widgetText(ctx, '{count} objects', { count: all.length }) : widgetText(ctx, '{shown} of {count} objects', { shown: shown.length, count: all.length });
    if (heldFocus) {
      if (!list.contains(focused)) search.focus();
      else if (doc.activeElement !== focused) focused!.focus();
    }
  }

  search.addEventListener('input', paint);
  const unsubscribe = objects.subscribe(items => {
    if (closed) return;
    all = items;
    paint();
  });
  const dispose = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe();
    search.removeEventListener('input', paint);
    rows.clear();
    all = [];
    opts.onClose?.();
  };
  const handle = openPanel(ctx, frame.el, {
    ...(anchor === undefined ? { placement: 'center' as const, modal: true } : { anchor, placement: 'below' as const }),
    initialFocus: search,
    onClose: dispose,
  }, () => {});
  return handle;
}

/** Append beside the shared widget and dialog styles when mounting this panel. */
export const OBJECTS_PANEL_CSS = `
.oac-widget .oac-objects { width: 440px; min-width: 0; }
.oac-widget .oac-objects .oac-dialog__body { display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
.oac-widget .oac-objects__find { width: 100%; min-width: 0; flex: none; }
.oac-widget .oac-objects__list { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 2px; }
.oac-widget .oac-objects__row { display: flex; flex-direction: column; gap: 4px; padding: 6px; margin-bottom: 4px;
  border: 1px solid var(--oac-bd-soft); border-radius: 6px; min-width: 0; }
.oac-widget .oac-objects__row.is-selected { border-color: var(--oac-acc); background: var(--oac-elev); }
.oac-widget .oac-objects__summary { display: flex; flex-direction: column; align-items: flex-start; justify-content: center;
  gap: 2px; width: 100%; min-width: 0; height: auto; padding: 3px 4px; text-align: left; white-space: normal; }
.oac-widget .oac-objects__name { font-weight: 600; overflow-wrap: anywhere; }
.oac-widget .oac-objects__meta, .oac-widget .oac-objects__status { font-size: 11px; color: var(--oac-mut); overflow-wrap: anywhere; }
.oac-widget .oac-objects__status[data-state="error"] { color: var(--oac-danger); }
.oac-widget .oac-objects__actions { display: flex; flex-wrap: wrap; gap: 3px; }
.oac-widget .oac-objects__actions .oac-btn { height: 26px; padding: 0 6px; font-size: 11px; }
.oac-widget .oac-objects__count { color: var(--oac-mut); font-size: 11px; }
`;
