import type { DataLoadingController, DataLoadingSnapshot } from 'openalgo-charts';
import { h, type WidgetContext } from './context';

export interface DataStatusHandle {
  readonly el: HTMLElement;
  update(state: DataLoadingSnapshot): void;
  destroy(): void;
}

/** Compact status furniture shares the widget palette and leaves the canvas reachable. */
export function mountDataStatus(
  ctx: WidgetContext, stage: HTMLElement, controller: DataLoadingController | null, retry: () => void,
): DataStatusHandle {
  const el = h(ctx.document, 'div', 'oac-data-status');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.hidden = true;
  stage.appendChild(el);
  let state = controller?.getState() ?? null;
  let signature = '';
  let destroyed = false;
  const stop = (event: Event): void => event.stopPropagation();
  for (const event of ['pointerdown', 'wheel', 'keydown']) el.addEventListener(event, stop);
  const render = (): void => {
    if (destroyed) return;
    const rows: { text: string; label?: string; retry?: () => void }[] = [];
    if (state !== null) {
      const symbol = state.request?.symbol ?? '';
      const interval = state.request?.interval ?? '';
      switch (state.status) {
        case 'loading': rows.push({ text: `Loading ${symbol} ${interval}` }); break;
        case 'refreshing': rows.push({ text: `Refreshing ${symbol} ${interval}` }); break;
        case 'empty': rows.push({ text: `No bars for ${symbol} ${interval}`, label: 'Retry chart data', retry }); break;
        case 'stale': rows.push({ text: `History is stale for ${symbol} ${interval}`, label: 'Retry chart data', retry }); break;
        case 'error': rows.push({ text: `Could not load ${symbol} ${interval}`, label: 'Retry chart data', retry }); break;
      }
      if (state.historyStatus === 'limited') rows.push({ text: 'History retention limit reached' });
      else if (state.historyStatus === 'loading') rows.push({ text: 'Loading older history' });
      else if (state.historyStatus === 'error') rows.push({ text: 'Could not load older history',
        label: 'Retry older history', retry: () => { void controller?.loadMore(); } });
    }
    for (const indicator of ctx.chart.indicators()) {
      const status = indicator.dataStatus();
      if (status === null || status.state === 'ready') continue;
      const label = { loading: 'Loading', empty: 'No data', unsupported: 'Unsupported', error: 'Could not load' }[status.state];
      rows.push({ text: `${indicator.name}: ${label}`, label: `Retry ${indicator.name}`,
        retry: status.state === 'loading' ? undefined : () => indicator.retryData() });
    }
    const next = JSON.stringify(rows.map(row => [row.text, row.label, !!row.retry]));
    if (signature === next) return;
    signature = next;
    el.textContent = '';
    el.hidden = rows.length === 0;
    for (const row of rows) {
      const line = h(ctx.document, 'div', 'oac-data-status__row');
      const text = h(ctx.document, 'span', 'oac-data-status__text');
      text.textContent = row.text;
      line.appendChild(text);
      if (row.retry) {
        const button = h(ctx.document, 'button', 'oac-btn');
        button.textContent = 'Retry';
        button.type = 'button';
        button.setAttribute('aria-label', row.label!);
        button.addEventListener('click', row.retry);
        line.appendChild(button);
      }
      el.appendChild(line);
    }
  };
  // An indicator can publish its first status inside its constructor, before
  // Chart has added the instance to its public collection.
  const changed = (): void => { render(); queueMicrotask(render); };
  const cleanups = ['indicator:data-status', 'indicatorRemoved'].map(event => ctx.chart.on(event, changed));
  render();
  return {
    el,
    update: snapshot => { state = snapshot; render(); },
    destroy: () => {
      destroyed = true;
      for (const cleanup of cleanups) cleanup();
      for (const event of ['pointerdown', 'wheel', 'keydown']) el.removeEventListener(event, stop);
      el.remove();
    },
  };
}
