import { AlertController } from '/dist/openalgo-charts.mjs';
import { createAlertUi } from '/dist/openalgo-charts.widget.mjs';
import { el, currentTheme, chartTheme, toast } from './ui.js';
import { autosave } from './persist.js';

/** Each chart owns an evaluator. Delivery stays in this host, separate from orders. */
export function attachAlerts(app, pane = 1) {
  const suffix = pane === 2 ? '2' : '';
  detachAlerts(app, pane);
  const chart = app['chart' + suffix];
  const draw = app['draw' + suffix];
  const alerts = new AlertController(chart, { drawings: draw });
  alerts.setPaused(Boolean(pane === 1 && (app.loading || app.loadFailed || app.replay || app.replayPicking || app.replayLoading)));
  // Dialogs use the workspace width even when their source chart is narrow.
  const ui = createAlertUi(el('split'), {
    chart, draw, alerts, theme: currentTheme(), chartTheme: chartTheme(),
  });
  app['alerts' + suffix] = alerts;
  app['alertUi' + suffix] = ui;
  const disposers = [];
  for (const event of ['alert:created', 'alert:updated', 'alert:removed', 'alert:triggered', 'alert:expired', 'alerts:checkpoint']) {
    disposers.push(chart.on(event, autosave));
  }
  disposers.push(chart.on('alert:triggered', event => {
    toast('success', event.message || event.title);
  }));
  disposers.push(chart.on('alert:error', () => toast('error', 'An alert condition could not be evaluated. Review its source.')));
  const themeChanged = () => ui.setTheme(currentTheme(), chartTheme());
  document.addEventListener('oac:theme', themeChanged);
  disposers.push(() => document.removeEventListener('oac:theme', themeChanged));
  app['disposeAlerts' + suffix] = () => {
    for (const dispose of disposers) dispose();
    ui.destroy();
    alerts.destroy();
  };
  return alerts;
}

export function detachAlerts(app, pane = 1) {
  const suffix = pane === 2 ? '2' : '';
  app['disposeAlerts' + suffix]?.();
  app['disposeAlerts' + suffix] = null;
  app['alertUi' + suffix] = null;
  app['alerts' + suffix] = null;
}

export function openAlerts(app) {
  const ui = app.focusPane === 2 && app.chart2 ? app.alertUi2 : app.alertUi;
  return ui?.openList() ?? false;
}
