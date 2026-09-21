import RunnableExample from './RunnableExample';

const code = `el.style.cssText = 'display:flex;flex-direction:column';
const controls = document.createElement('div');
controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:8px 64px 8px 8px';
const output = document.createElement('output');
output.dataset.alertLifecycleState = '';
output.setAttribute('role', 'status');
output.style.cssText = 'padding:0 10px 8px;font:12px/1.6 system-ui';
const stage = document.createElement('div');
stage.style.cssText = 'flex:1;min-height:240px;position:relative';
el.append(controls, output, stage);
const chart = lib.createChart(stage, { timeNavigator: false, priceAxisWidth: 64 });
chart.setDataContext({ symbol: 'SYNTHETIC', exchange: 'DEMO', interval: '1m' });
const series = chart.addSeries('candlestick');
const bars = Array.from({ length: 40 }, (_, i) => {
  const close = i === 39 ? 100 : 100 + Math.sin(i / 4);
  return { time: 1735689600 + i * 60, open: close - 0.5, high: close + 1, low: close - 1, close };
});
series.setData(bars);
chart.setVisibleLogicalRange({ from: -2, to: 44 });
chart.panes()[0].priceScale.setFixedRange({ min: 90, max: 118 });
let spentLines = 'hide';
let alerts = new lib.AlertController(chart, { spentLines, now: () => 1000 });
let deliveries = 0;
const listeners = new AbortController();
chart.on('alert:triggered', () => { deliveries++; });
function show() {
  const records = alerts.list();
  const once = records.find(record => record.id === 'once');
  output.textContent = 'Finished lines: ' + spentLines + '. Once alert: ' + once.state
    + '. Saved records: ' + records.length + '. Deliveries: ' + deliveries + '.';
  output.dataset.policy = spentLines;
  output.dataset.state = once.state;
  output.dataset.records = String(records.length);
  output.dataset.deliveries = String(deliveries);
}
function restore() {
  const saved = alerts.toJSON();
  alerts.destroy();
  alerts = new lib.AlertController(chart, { spentLines, now: () => 1000 });
  alerts.fromJSON(saved);
  show();
}
function reset() {
  series.setData(bars);
  for (const alert of alerts.list()) alerts.remove(alert.id);
  alerts.add({ id: 'once', title: 'Once threshold', source: { kind: 'price', price: 105 }, policy: 'onTouch', condition: 'crossingUp' });
  alerts.add({ id: 'repeat', title: 'Repeating threshold', source: { kind: 'price', price: 108 }, policy: 'onTouch', condition: 'crossingUp', repeat: 'everyTime' });
  alerts.add({ id: 'armed', title: 'Watching threshold', source: { kind: 'price', price: 114 } });
  alerts.add({ id: 'expired', title: 'Expired threshold', source: { kind: 'price', price: 94 }, expiresAt: 999 });
  deliveries = 0;
  show();
}
function button(label, action, key) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.dataset.alertLifecycleAction = key;
  node.style.cssText = 'min-height:34px;padding:5px 9px;border:1px solid var(--oac-card-border);border-radius:5px;background:var(--oac-card);color:inherit;font:12px system-ui;cursor:pointer';
  node.addEventListener('click', action, { signal: listeners.signal });
  controls.appendChild(node);
  return node;
}
button('Trigger alerts', () => {
  series.update({ ...bars[bars.length - 1], high: 110, close: 110 });
  show();
}, 'trigger');
button('Restore records', restore, 'restore');
button('Re-arm once alert', () => { alerts.enable('once'); show(); }, 'rearm');
const policy = button('Show finished lines', () => {
  spentLines = spentLines === 'hide' ? 'show' : 'hide';
  policy.textContent = spentLines === 'hide' ? 'Show finished lines' : 'Hide finished lines';
  restore();
}, 'policy');
button('Reset', reset, 'reset');
reset();
el.dataset.alertLifecycleReady = 'true';
return { destroy() { delete el.dataset.alertLifecycleReady; listeners.abort(); alerts.destroy(); chart.destroy(); } };`;

export default function AlertLifecycleDemo() {
  return <div id="alert-lifecycle-demo"><RunnableExample height={440} code={code}
    caption="Synthetic intrabar updates. Trigger alerts to hide the once-only line, restore the saved records, or re-arm it. Repeating alerts keep their lines. Showing finished lines changes only their display." /></div>;
}
