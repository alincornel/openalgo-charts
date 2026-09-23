import React from 'react';
import RunnableExample from './RunnableExample';

const code = `el.style.cssText += ';display:flex;flex-direction:column';
const controls = document.createElement('div');
controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:8px;font:12px system-ui,sans-serif;flex-shrink:0';
const grid = document.createElement('div');
grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));grid-auto-rows:minmax(0,1fr);flex:1;min-height:0';
const note = document.createElement('p');
note.style.cssText = 'margin:6px 10px;font:12px system-ui,sans-serif;color:#94a3b8;flex-shrink:0';
note.textContent = 'Synthetic bars and sample events. Drawings share time anchors; each chart computes its own volume study.';
el.append(controls, grid, note);
const bars = lib.generateBars(1700000000, 100, 3600);
const charts = [0, 1].map(index => {
  const host = document.createElement('div');
  host.style.cssText = 'min-width:0;min-height:0;height:100%';
  grid.appendChild(host);
  const widget = lib.createWidget(host, { symbol:'SAMPLE', exchange:'DEMO', interval:'1h',
    persist:false, topbar:false, statusline:false, rail:false, timeNavigator:false });
  widget.series.setData(bars);
  widget.chart.timeScale.fitContent(bars.length);
  return widget;
});
const [first, second] = charts;
const drawings = new lib.DrawingLinkGroup({ enabled:true });
const views = lib.createLinkGroup({ crosshair:true, viewport:true, appearance:true });
for (const widget of charts) {
  drawings.add(widget.chart, widget.draw);
  views.add(widget.chart, { appearance: {
    read: () => lib.readChartSettings(widget.chart),
    apply: patch => lib.applyChartSettings(widget.chart, patch),
  } });
}
function button(label, run) {
  const button = document.createElement('button');
  button.textContent = label;
  button.type = 'button';
  button.style.cssText = 'font:inherit;padding:5px 9px;border:1px solid #455166;border-radius:4px;background:#182233;color:#e2e8f0';
  button.addEventListener('pointerdown', e => e.stopPropagation());
  button.addEventListener('click', run);
  controls.appendChild(button);
  return button;
}
button('Anchor VWAP', () => first.draw.setTool('anchored-vwap'));
button('Range profile', () => first.draw.setTool('fixed-range-volume-profile'));
button('Undo', () => first.draw.undo());
let linked = true;
const sync = button('Drawing sync: on', () => {
  linked = !linked; drawings.setOptions({ enabled:linked });
  sync.textContent = 'Drawing sync: ' + (linked ? 'on' : 'off');
});
let bright = false;
button('Change candle colors', () => {
  bright = !bright;
  lib.applyChartSettings(first.chart, { 'symbol.upColor': bright ? '#60a5fa' : '#26a69a',
    'symbol.downColor': bright ? '#fbbf24' : '#ef5350' });
});
first.chart.setEventMarkerOptions({ clustering:true });
first.chart.setEventGroups([{ id:'company', label:'Company' }]);
first.chart.setEvents([
  { id:'demo-results', time:bars[70].time, type:'earnings', label:'E', group:'company',
    title:'Sample results', details:'Synthetic event data for this example.' },
  { id:'demo-call', time:bars[70].time + 60, type:'news', label:'N', group:'company',
    title:'Sample investor call', details:{ summary:'Select each event in the clustered marker.',
      fields:[{ label:'Source', value:'Example data' }] } },
]);
let eventsVisible = true;
button('Toggle sample events', () => first.chart.setEventGroupVisible('company', eventsVisible = !eventsVisible));
first.draw.add({ tool:'anchored-vwap', paneIndex:0, style:{ color:'#fbbf24', lineWidth:2 },
  points:[{ time:bars[20].time, price:bars[20].close }] });
first.draw.add({ tool:'fixed-range-volume-profile', paneIndex:0, style:{ color:'#60a5fa' },
  points:[{ time:bars[45].time, price:bars[45].close }, { time:bars[88].time, price:bars[88].close }] });
return { destroy() { drawings.destroy(); views.destroy(); charts.forEach(widget => widget.destroy());
  controls.remove(); grid.remove(); note.remove(); } };`;

export default function LinkedAnalysisDemo() {
  return <div className="oac-linked-analysis"><RunnableExample code={code} tiers={['widget', 'draw']} height={540}
    caption="Click a tool, then place anchors on the left chart. Drag a drawing to move it on both charts. Click the event count near the time axis to read sample event details." /></div>;
}
