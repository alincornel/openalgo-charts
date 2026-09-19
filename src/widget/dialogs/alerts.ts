import { alertSettingsSchema, getBarCondition, type Alert, type AlertCondition, type AlertInput, type AlertPatch, type AlertSource } from 'openalgo-charts';
import type { WidgetContext } from '../context';
import { button, controlsFromInputs, dialogFrame, el, openPanel, renderForm, type FormHandle, type PanelHandle } from '../form';
import { alertSourceFields } from './alert-source';

export interface AlertEditorOptions {
  /** Edit this record; omit to create a new alert. */
  alertId?: string;
  /** Seed a draft from a plot, clicked price or drawing anchor. */
  source?: AlertSource;
  onClose?(): void;
}

export interface AlertsPanelOptions {
  onClose?(): void;
}

let editorSequence = 0;

function expiryText(value: number | undefined): string {
  return value === undefined ? '' : new Date(value * 1000).toISOString().slice(0, 16);
}

function expiryValue(value: unknown): number | undefined {
  if (value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter an expiry date and time in UTC');
  const seconds = Date.parse(value + ':00Z') / 1000;
  if (!Number.isFinite(seconds) || expiryText(seconds) !== value) throw new Error('Enter a valid expiry date and time in UTC');
  return seconds;
}

/** Draft edits never arm an alert until Save. Closing always discards the draft. */
export function mountAlertEditor(ctx: WidgetContext, anchor?: HTMLElement, opts: AlertEditorOptions = {}): PanelHandle {
  const alerts = ctx.alerts;
  const existing = alerts?.list().find(alert => alert.id === opts.alertId);
  const initialContext = ctx.chart.getDataContext();
  const scope = (value: typeof initialContext): string => JSON.stringify([value?.symbol, value?.exchange, value?.interval]);
  const initialScope = scope(initialContext);
  const bars = ctx.chart.primaryBars();
  const source = existing?.source ?? opts.source ?? { kind: 'price', price: bars[bars.length - 1]?.close };
  let form: FormHandle;
  let closed = false;
  let enabledChanged = false;
  const formId = `oac-alert-${++editorSequence}`;
  const off: (() => void)[] = [];
  let draft: Record<string, unknown> = {
    ...existing, ...source,
    ...(source.kind === 'drawing' ? { inputInstanceId: source.input?.instanceId, inputPlotKey: source.input?.plotKey } : {}),
    ...(source.kind === 'barCondition' ? { barConditionId: source.id } : {}),
    enabled: existing ? existing.state === 'armed' : true,
    expiresAt: expiryText(existing?.expiresAt),
  };
  function close(): void {
    if (closed) return;
    closed = true;
    for (const dispose of off.splice(0)) dispose();
    panel?.close();
    opts.onClose?.();
  }
  const frame = dialogFrame(ctx.document, { title: existing ? 'Edit alert' : 'Create alert', className: 'oac-alert-editor', onClose: close });
  frame.closeButton.textContent = 'Close';
  frame.closeButton.classList.remove('oac-btn--icon');
  const context = el(ctx.document, 'p', 'oac-alert-context', [initialContext?.symbol, initialContext?.exchange, initialContext?.interval].filter(Boolean).join(' / '));
  const fields = el(ctx.document, 'div');
  const availability = el(ctx.document, 'p', 'oac-alert-help');
  const timing = el(ctx.document, 'p', 'oac-alert-help', 'Bar close evaluates confirmed values. Intrabar touch can fire on a wick that is absent from final history.');
  const error = el(ctx.document, 'p', 'oac-alert-error');
  error.setAttribute('role', 'status');
  frame.body.append(context, fields, availability, timing, error);
  const save = button(ctx.document, { label: 'Save', variant: 'primary', onClick: commit });
  save.dataset.action = 'save-alert';
  const cancel = button(ctx.document, { label: 'Cancel', onClick: close });
  cancel.dataset.action = 'cancel-alert';
  frame.actions.append(cancel, save);

  function unavailable(): string | undefined {
    if (!alerts) return 'Alerts are unavailable in this host';
    if (opts.alertId && !alerts.list().some(alert => alert.id === opts.alertId)) return 'This alert was removed';
    if (scope(ctx.chart.getDataContext()) !== initialScope || (existing && scope(existing.scope) !== initialScope)) return 'The instrument context changed. Reopen the editor for the intended instrument.';
    return alertSourceFields(ctx, draft).reason;
  }
  function refreshAvailability(): void {
    const reason = unavailable();
    error.textContent = reason ?? '';
    save.disabled = reason !== undefined;
    availability.textContent = alertSourceFields(ctx, draft).hint ?? '';
  }
  function render(): void {
    const selection = alertSourceFields(ctx, draft);
    const schema = alertSettingsSchema(selection.source, draft.condition as AlertCondition | undefined);
    for (const field of schema) if (!(field.key in draft)) draft[field.key] = field.default;
    draft.condition = schema.find(field => field.key === 'condition')!.default;
    form = renderForm(fields, [...selection.controls, ...controlsFromInputs(schema)], {
      idPrefix: formId, values: draft, preserveInvalidNumbers: true,
      onChange: (key, value) => {
        draft = { ...draft, ...form.values(), [key]: value };
        if (key === 'enabled') enabledChanged = true;
        const changedSource = ['kind', 'instanceId', 'plotKey', 'drawingId', 'level', 'inputInstanceId'].includes(key);
        if (key === 'kind') {
          for (const name of ['price', 'value', 'upperPrice', 'upperValue', 'condition']) delete draft[name];
        }
        if (key === 'instanceId') { delete draft.plotKey; delete draft.value; delete draft.upperValue; }
        if (key === 'plotKey') { delete draft.value; delete draft.upperValue; }
        if (key === 'drawingId') { delete draft.level; delete draft.inputInstanceId; delete draft.inputPlotKey; }
        if (key === 'inputInstanceId') delete draft.inputPlotKey;
        if (key === 'condition' || changedSource) {
          const focused = ctx.document.activeElement !== null && fields.contains(ctx.document.activeElement);
          render();
          if (focused) fields.querySelector<HTMLElement>(`[data-key="${key}"] select`)?.focus();
        }
        refreshAvailability();
      },
    });
    const expiry = fields.querySelector<HTMLInputElement>('[data-key="expiresAt"] input');
    if (expiry) { expiry.type = 'datetime-local'; expiry.step = '60'; }
  }
  function commit(): void {
    if (closed) return;
    try {
      const reason = unavailable();
      if (reason) throw new Error(reason);
      draft = { ...draft, ...form.values() };
      const condition = draft.condition as AlertCondition;
      const range = condition === 'enteringRange' || condition === 'leavingRange';
      const selected = alertSourceFields(ctx, draft).source;
      const nextSource: AlertSource = selected.kind === 'price'
        ? { kind: 'price', price: draft.price as number, ...(range ? { upperPrice: draft.upperPrice as number } : {}) }
        : selected.kind === 'indicator'
          ? { ...selected, value: draft.value as number, upperValue: range ? draft.upperValue as number : undefined }
          : selected;
      const patch: AlertPatch = {
        source: nextSource, condition, title: String(draft.title ?? ''), message: String(draft.message ?? '') || undefined,
        policy: draft.policy as AlertInput['policy'], repeat: draft.repeat as AlertInput['repeat'],
        cooldownSeconds: draft.cooldownSeconds as number,
      };
      if (!existing || draft.expiresAt !== expiryText(existing.expiresAt)) patch.expiresAt = expiryValue(draft.expiresAt);
      if (!existing || enabledChanged) patch.state = draft.enabled ? 'armed' : 'disabled';
      if (existing) alerts!.update(existing.id, patch);
      else alerts!.add(patch as AlertInput);
      close();
    } catch (cause) { error.textContent = cause instanceof Error ? cause.message : 'Could not save this alert'; }
  }
  render();
  refreshAvailability();
  for (const event of ['data:context', 'data:update', 'objects:change', 'alert:removed', 'alerts:restored']) off.push(ctx.chart.on(event, refreshAvailability));
  off.push(ctx.chart.on('destroy', close));
  const panel = openPanel(ctx, frame.el, { anchor, modal: true, placement: 'center' }, close);
  return { el: frame.el, close, isOpen: () => !closed && panel.isOpen() };
}

/** All lifecycle states remain visible until explicitly deleted. */
export function mountAlertsPanel(ctx: WidgetContext, anchor?: HTMLElement, opts: AlertsPanelOptions = {}): PanelHandle {
  const alerts = ctx.alerts;
  let closed = false;
  let rendering = false;
  const off: (() => void)[] = [];
  const rows = new Map<string, { el: HTMLElement; summary: HTMLElement; status: HTMLElement; toggle: HTMLButtonElement }>();
  function close(): void {
    if (closed) return;
    closed = true;
    for (const dispose of off.splice(0)) dispose();
    panel?.close();
    opts.onClose?.();
  }
  const frame = dialogFrame(ctx.document, { title: 'Alerts', className: 'oac-alerts', onClose: close });
  frame.closeButton.textContent = 'Close';
  frame.closeButton.classList.remove('oac-btn--icon');
  const list = el(ctx.document, 'div', 'oac-alerts__list');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Chart alerts');
  const empty = el(ctx.document, 'p', 'oac-empty', alerts ? 'No alerts. Create an alert for this chart.' : 'Alerts are unavailable in this host');
  const count = el(ctx.document, 'span', 'oac-alert-context');
  count.setAttribute('role', 'status');
  const create = button(ctx.document, { label: 'Create alert', variant: 'primary', onClick: () => { mountAlertEditor(ctx); } });
  create.dataset.action = 'create-alert';
  create.disabled = !alerts;
  frame.body.append(list, empty);
  frame.lead.appendChild(count);
  frame.actions.appendChild(create);
  const stateNames = { armed: 'Armed', triggered: 'Triggered', expired: 'Expired', disabled: 'Disabled' };
  function sourceText(alert: Alert): string {
    const source = alert.source;
    if (source.kind === 'price') return `Price ${source.price}${source.upperPrice === undefined ? '' : ` to ${source.upperPrice}`}`;
    if (source.kind === 'barCondition') return getBarCondition(source.id)?.title ?? 'Unavailable candle condition';
    if (source.kind === 'drawing') {
      const selection = alertSourceFields(ctx, { ...source, inputInstanceId: source.input?.instanceId, inputPlotKey: source.input?.plotKey });
      const drawing = selection.controls.find(control => control.key === 'drawingId')?.options?.find(option => option.value === source.drawingId)?.label;
      return `${drawing ?? 'Unavailable drawing'} / ${source.level ?? 'Default level'}`;
    }
    const instance = ctx.chart.indicators().find(item => item.id === source.instanceId);
    return `${instance?.name ?? 'Unavailable study'} / ${source.plotKey}: ${source.value}${source.upperValue === undefined ? '' : ` to ${source.upperValue}`}`;
  }
  function render(): void {
    if (closed || rendering) return;
    rendering = true;
    try {
      const records = alerts?.list() ?? [];
      const ids = new Set(records.map(alert => alert.id));
      for (const [id, row] of rows) if (!ids.has(id)) { row.el.remove(); rows.delete(id); }
      for (const alert of records) {
        let row = rows.get(alert.id);
        if (!row) {
          const node = el(ctx.document, 'div', 'oac-alerts__row');
          node.dataset.alertId = alert.id;
          node.setAttribute('role', 'listitem');
          const summary = el(ctx.document, 'div', 'oac-alerts__summary');
          const status = el(ctx.document, 'div', 'oac-alerts__status');
          const actions = el(ctx.document, 'div', 'oac-alerts__actions');
          const edit = button(ctx.document, { label: 'Edit', onClick: () => { mountAlertEditor(ctx, undefined, { alertId: alert.id }); } });
          edit.dataset.action = 'edit-alert';
          const toggle = button(ctx.document, { label: 'Disable', onClick: () => {
            const current = alerts?.list().find(item => item.id === alert.id);
            if (current?.state === 'armed') alerts?.disable(alert.id);
            else alerts?.enable(alert.id);
          } });
          toggle.dataset.action = 'toggle-alert';
          const remove = button(ctx.document, { label: 'Delete', onClick: () => { alerts?.remove(alert.id); } });
          remove.dataset.action = 'delete-alert';
          actions.append(edit, toggle, remove);
          node.append(summary, status, actions);
          list.appendChild(node);
          row = { el: node, summary, status, toggle };
          rows.set(alert.id, row);
        }
        const scope = [alert.scope.symbol, alert.scope.exchange, alert.scope.interval].filter(Boolean).join(' / ');
        row.summary.textContent = `${alert.title}\n${scope}\n${sourceText(alert)}`;
        row.el.dataset.state = alert.state;
        const available = alerts!.availability(alert.id);
        row.status.textContent = [stateNames[alert.state], alert.policy === 'onBarClose' ? 'Bar close' : 'Intrabar touch',
          alert.repeat === 'once' ? 'Once' : 'Every match',
          alert.cooldownSeconds ? `${alert.cooldownSeconds}s cooldown` : '',
          alert.expiresAt === undefined ? '' : `Expires ${expiryText(alert.expiresAt).replace('T', ' ')} UTC`,
          alert.lastTriggeredAt === undefined ? '' : `Last fired ${expiryText(alert.lastTriggeredAt).replace('T', ' ')} UTC`,
          available.available ? '' : available.reason,
        ].filter(Boolean).join(' / ');
        row.toggle.textContent = alert.state === 'armed' ? 'Disable' : 'Enable';
        row.toggle.setAttribute('aria-label', `${alert.state === 'armed' ? 'Disable' : 'Enable'} ${alert.title}`);
        row.toggle.disabled = alert.state !== 'armed' && alert.expiresAt !== undefined && alert.expiresAt <= Date.now() / 1000;
        row.toggle.title = row.toggle.disabled ? 'Edit the expiry before enabling this alert' : '';
      }
      empty.hidden = records.length > 0;
      count.textContent = `${records.length} alert${records.length === 1 ? '' : 's'}`;
    } finally { rendering = false; }
  }
  for (const event of ['alert:created', 'alert:updated', 'alert:removed', 'alert:triggered', 'alert:expired', 'alerts:restored',
    'data:context', 'data:update', 'objects:change', 'replay:start', 'replay:stop']) off.push(ctx.chart.on(event, render));
  off.push(ctx.chart.on('destroy', close));
  render();
  const panel = openPanel(ctx, frame.el, { anchor, modal: true, placement: 'center' }, close);
  return { el: frame.el, close, isOpen: () => !closed && panel.isOpen() };
}
