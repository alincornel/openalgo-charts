import { darkTheme, lightTheme, type AlertController, type Chart, type ChartTheme } from 'openalgo-charts';
import type { DrawingController } from 'openalgo-charts/draw';
import { createOverlayStack, createTipController, h, WidgetBus, WidgetStorage, type WidgetContext } from './context';
import { mountAlertEditor, mountAlertsPanel, type AlertEditorOptions } from './dialogs/alerts';
import { DIALOG_CSS } from './dialogs/index';
import { OBJECTS_PANEL_CSS } from './objects-panel';
import type { PanelHandle } from './form';
import { Keymap } from './keymap';
import { injectWidgetStyles } from './styles';
import { mountToasts } from './toast';
import { applyTokens, widgetTokens, type WidgetThemeName } from './tokens';

export interface AlertUiOptions {
  chart: Chart;
  draw: DrawingController;
  alerts: AlertController;
  theme?: WidgetThemeName;
  chartTheme?: ChartTheme;
  locale?: string;
  styleNonce?: string;
  /** Suspend host keyboard shortcuts while any alert dialog is open. */
  onOpenChange?(open: boolean): void;
}

export interface AlertUi {
  readonly root: HTMLElement;
  openList(anchor?: HTMLElement): boolean;
  openEditor(options?: AlertEditorOptions): boolean;
  isOpen(): boolean;
  close(): void;
  setTheme(name: WidgetThemeName, theme?: ChartTheme): void;
  /** Releases UI only. The host still owns its chart and controllers. */
  destroy(): void;
}

/** Mount shared alert dialogs over a custom host's positioned chart container. */
export function createAlertUi(container: HTMLElement, options: AlertUiOptions): AlertUi {
  const doc = container.ownerDocument;
  injectWidgetStyles(doc, DIALOG_CSS + OBJECTS_PANEL_CSS, options.styleNonce);
  const root = h(doc, 'div', 'oac-widget oac-alert-host');
  container.appendChild(root);
  const overlays = createOverlayStack(root, doc);
  const tips = createTipController(root, overlays.layer, doc);
  const toastRoot = h(doc, 'div', 'oac-toasts');
  root.appendChild(toastRoot);
  const toasts = mountToasts(toastRoot, doc);
  let theme = options.theme ?? 'dark';
  let chartTheme = options.chartTheme ?? (theme === 'light' ? lightTheme : darkTheme);
  let destroyed = false;
  let open = false;
  let list: PanelHandle | null = null;
  function announce(): void {
    const next = overlays.size() > 0;
    if (next === open) return;
    open = next;
    options.onOpenChange?.(open);
  }
  const ctx: WidgetContext = {
    chart: options.chart, draw: options.draw, alerts: options.alerts, root, document: doc,
    get theme() { return theme; }, get chartTheme() { return chartTheme; },
    keymap: new Keymap(), bus: new WidgetBus(), storage: new WidgetStorage('alert-ui', null),
    locale: options.locale, tips, overlays,
    toast: (message, kind) => toasts.toast(message, kind),
    status: (message, kind) => { toasts.toast(message, kind); },
    symbol: () => ({ symbol: options.chart.getDataContext()?.symbol ?? '', exchange: options.chart.getDataContext()?.exchange ?? '' }),
    interval: () => options.chart.getDataContext()?.interval ?? '',
    openOverlay: (element, opts) => {
      const close = overlays.open(element, { ...opts, onClose: () => { opts?.onClose?.(); announce(); } });
      announce();
      return close;
    },
  };
  // Text fields and buttons must not bubble ordinary trading shortcuts to the host.
  const stopKeys = (event: KeyboardEvent): void => { event.stopPropagation(); };
  root.addEventListener('keydown', stopKeys);
  const offDestroy = options.chart.on('destroy', () => ui.destroy());
  const ui: AlertUi = {
    root,
    openList: anchor => {
      if (destroyed) return false;
      if (list?.isOpen()) { list.el.focus(); return true; }
      list = mountAlertsPanel(ctx, anchor, { onClose: () => { list = null; } });
      return true;
    },
    openEditor: editorOptions => {
      if (destroyed) return false;
      mountAlertEditor(ctx, undefined, editorOptions);
      return true;
    },
    isOpen: () => !destroyed && overlays.size() > 0,
    close: () => overlays.closeAll(),
    setTheme: (name, palette) => {
      if (destroyed) return;
      theme = name;
      chartTheme = palette ?? (name === 'light' ? lightTheme : darkTheme);
      root.dataset.theme = name;
      applyTokens(root, widgetTokens(chartTheme, name));
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      offDestroy();
      overlays.destroy(); tips.destroy(); toasts.destroy(); ctx.keymap.destroy(); ctx.bus.clear();
      root.removeEventListener('keydown', stopKeys);
      root.remove();
    },
  };
  ui.setTheme(theme, chartTheme);
  return ui;
}
