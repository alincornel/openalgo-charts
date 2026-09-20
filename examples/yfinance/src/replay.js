import * as engine from '/dist/openalgo-charts.mjs';
import { el, onEscape } from './ui.js';
import { fetchBars, abortFetch } from './feed.js';
import { renderToolbar, ticon } from './toolbar.js';
import { attachTip } from './hover.js';
import { setLegend } from './volume.js';
import { capturePaneTarget } from './pane-target.js';

// Read off the namespace rather than named above on purpose: a missing named
// import fails the whole module at link time, and a demo served against a
// dist/ built before replay shipped should still draw a chart and simply
// report the feature as unavailable.
const { ReplayController, TextWatermark, ReplayShade } = engine;

let app;

// ── market replay ──────────────────────────────────────────────────────
// ReplayController owns the playhead and feeds the series a prefix of the
// session; indicators reconstruct themselves because the chart recomputes
// them from the shortened history. Everything below is the transport bar.
export const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10];
let replaySpeed = 1;
/** Base-interval bars under the displayed ones, for intra-bar replay. */
let replaySubBars = null;
let replayLoadRevision = 0;
const requestKey = req => JSON.stringify([req.symbol, req.interval, req.period]);
const readouts = new WeakMap();
let controlHomes = [];
export function syncReplayAlertPause() {
  const active = Boolean(app.replay || app.replayPicking || app.replayLoading);
  app.alerts?.setPaused(active || Boolean(app.loading || app.loadFailed));
  app.alerts2?.setPaused(active || Boolean(app.loading2 || app.loadFailed2));
}

function captureReplayTarget() {
  const target = capturePaneTarget(app);
  if (!target) return null;
  const timezone = target.chart.timezone?.() || app.chartTimezone;
  return { ...target, timezone, series: target.chart.primarySeries?.() || (target.pane === 1 ? app.price : null),
    node: el(target.pane === 2 ? 'chart2' : 'chart'), shades: [], mark: null,
    current: () => target.current() && (target.chart.timezone?.() || app.chartTimezone) === timezone };
}
const ready = target => target?.current() && target.series
  && !app[target.pane === 2 ? 'loading2' : 'loading'] && !app[target.pane === 2 ? 'loadFailed2' : 'loadFailed'];
const owner = () => app.replayTarget || captureReplayTarget();

function mountControls(target) {
  const parent = target.node.parentElement || target.node.parentNode;
  if (parent) for (const [node] of controlHomes) parent.appendChild(node);
}

function releaseTarget(destroyed = false) {
  const target = app.replayTarget;
  if (target) {
    target.node.classList.remove('is-picking');
    if (!destroyed) {
      for (const primitive of [...target.shades, target.mark].filter(Boolean)) target.chart.removePrimitive?.(primitive);
    }
  }
  app.replayTarget = null;
  app.replayPickIndex = null;
  for (const [node, home] of controlHomes) if (home) home.appendChild(node);
}

/** Each chart owns its input listeners; linked hover cannot choose a replay bar. */
export function attachReplay(chart, pane, readout) {
  readouts.set(chart, readout);
  const off = [];
  for (const event of ['replay:start', 'replay:frame', 'replay:play', 'replay:pause', 'replay:end', 'replay:stop']) {
    off.push(chart.on(event, state => {
      if (app.replayTarget?.chart !== chart) return;
      syncReplayBar();
      if (state?.bar) readout?.(state.bar);
    }));
  }
  off.push(chart.on('crosshair:move', event => {
    if (event.source !== 'linked') movePick(event.index, chart);
  }));
  off.push(chart.on('click', () => {
    if (app.replayTarget?.chart === chart && app.replayPicking && app.replayPickIndex !== null) startReplayAt(app.replayPickIndex);
  }));
  off.push(chart.on('destroy', () => {
    if (app.replayTarget?.chart === chart) exitReplay(pane, true);
    for (const dispose of off.splice(0)) dispose();
    readouts.delete(chart);
  }));
}

/**
 * The interval a displayed bar is built from, so replay can form one in
 * front of the user instead of landing it whole.
 *
 * One rung down, not the finest available: 1-minute bars under a daily chart
 * would be 375 steps per candle, which is not a replay, it is a stall. The
 * pairs stop where the feed does, and an interval with no rung below it
 * simply replays bar by bar as before.
 */
export const REPLAY_SUB_INTERVAL = {
  '5m': '1m', '15m': '5m', '30m': '15m', '60m': '15m', '1h': '15m',
  '1d': '60m', '1wk': '1d', '1mo': '1d',
};

/** Where the newest bar sits while replay is running (or the real one). */
export const lastBar = () => (app.replay && app.replayTarget?.pane !== 2 ? app.replay.state().bar : null) || app.currentBars[app.currentBars.length - 1];

/**
 * Open at the left edge of what the user is looking at, so replay starts
 * where their attention already is. Floored so an indicator has some history
 * to compute from rather than opening on a single bar.
 */
export function replayStartIndex(total) {
  let from = 0;
  try { from = Math.round(owner().chart.timeScale.getVisibleLogicalRange().from); } catch (_) { from = 0; }
  const floor = Math.min(20, total - 1);
  return Math.max(floor, Math.min(total - 1, from));
}

/**
 * Step one: choose where to start.
 *
 * Replay used to open at the left edge of the viewport, which quietly
 * decided the exercise for the user. The bar you start from is the whole
 * premise -- "from here, what happens next?" -- so it is picked, and while
 * it is being picked everything to the right is greyed. Choosing a start
 * while able to read the next twenty bars is choosing on hindsight, which is
 * the one thing replay exists to remove.
 */
export function enterReplay() {
  if (app.replay || app.replayPicking || app.replayLoading) return;
  const target = captureReplayTarget();
  if (!ready(target)) return;
  if (!ReplayController) { el('status').textContent = 'replay is not in this build of dist/'; return; }
  const bars = target.series.getData();
  if (bars.length < 2) { el('status').textContent = 'replay needs bars'; return; }
  app.replayTarget = target;
  mountControls(target);
  app.replayPicking = true;
  syncReplayAlertPause();
  app.replayPickIndex = replayStartIndex(bars.length);
  setShadeIndex(app.replayPickIndex);
  target.node.classList.add('is-picking');
  el('replaypick').hidden = false;
  syncPickHint();
  renderToolbar();
  el('status').textContent = `Chart ${target.pane}: click a bar to replay from (Esc to cancel)`;
}

/**
 * Move (or raise, or clear) the veil on every pane.
 *
 * Built lazily and per pane because a pane can appear while the picker is
 * open -- an oscillator added mid-selection -- and a pane left bright to the
 * right of the cut shows exactly what the shade is hiding on the one above.
 */
export function setShadeIndex(index) {
  const target = app.replayTarget;
  if (!ReplayShade || !target) return;
  const panes = target.chart.panes ? target.chart.panes() : [];
  for (let i = target.shades.length; i < panes.length; i++) {
    const shade = new ReplayShade({ index: null, lineVisible: i === 0 });
    target.chart.addPrimitive(shade, i);
    target.shades.push(shade);
  }
  for (const shade of target.shades) shade.setOptions({ index });
}

/** The hovered bar, while the picker is open. */
export function movePick(index, chart = app.replayTarget?.chart) {
  if (!app.replayPicking || index === null || index === undefined) return;
  const target = app.replayTarget;
  if (!target || target.chart !== chart) return;
  const total = target.series.getData().length;
  if (total === 0) return;
  const clamped = Math.max(0, Math.min(total - 1, Math.round(index)));
  if (clamped === app.replayPickIndex) return;
  app.replayPickIndex = clamped;
  setShadeIndex(clamped);
  syncPickHint();
}

export function syncPickHint() {
  const bars = app.replayTarget?.series.getData() || [];
  const b = bars[app.replayPickIndex];
  const hint = el('rp-picked');
  if (hint) hint.textContent = b ? barStamp(b.time) : '';
}

export function cancelPick(destroyed = false) {
  if (!app.replayPicking && !app.replayLoading) return;
  replayLoadRevision++;
  abortFetch('replay');
  app.replayLoading = false;
  app.replayPicking = false;
  releaseTarget(destroyed);
  syncReplayAlertPause();
  el('replaypick').hidden = true;
  renderToolbar();
  el('status').textContent = 'replay cancelled';
}

/**
 * Step two: walk forward from the chosen bar.
 *
 * The shade comes off here rather than staying on the un-walked future,
 * because replay truncates the series: past the playhead there is nothing
 * left to cover.
 */
export async function startReplayAt(index) {
  if (app.replay || app.replayLoading) return;
  const target = owner();
  if (!ready(target)) return;
  const bars = target.series.getData();
  if (bars.length < 2) return;
  app.replayTarget = target;
  mountControls(target);
  const revision = ++replayLoadRevision;
  app.replayLoading = true;
  app.replayPicking = false;
  syncReplayAlertPause();
  target.node.classList.remove('is-picking');
  el('replaypick').hidden = true;
  setShadeIndex(null);

  renderToolbar();
  const sub = await loadReplaySubBars(target);
  if (revision !== replayLoadRevision) return;
  if (!target.current()) { cancelPick(); return; }
  // Volume and its average derive from the displayed primary bars. Driving
  // only the price lets them follow forming bars without replaying a final
  // history volume into an unfinished candle.
  app.replay = new ReplayController(target.chart, {
    series: [target.series],
    startIndex: Math.max(0, Math.min(bars.length - 1, index)),
    subBars: sub || undefined,
    barMs: 1000,
    speed: replaySpeed,
  });
  app.replayLoading = false;
  showReplayMark(true);
  buildReplayBar();
  el('replaybar').hidden = false;
  syncReplayBar();
  renderToolbar();
  const steps = app.replay.state().subSteps;
  el('status').textContent = steps > 1
    ? `Chart ${target.pane}: each ${target.request.interval} bar forms in ${steps} steps of ${REPLAY_SUB_INTERVAL[target.request.interval]}`
    : 'replay: press play, or scrub / step through the session';
}

/**
 * The base-interval session under the displayed one.
 *
 * Fetched once per interval and kept, because it is history: closed bars do
 * not change. A failure is not an error the user needs to see -- replay
 * simply falls back to whole-bar steps -- so it is swallowed rather than
 * blocking the mode on a second network call.
 */
export async function loadReplaySubBars(target = owner()) {
  if (!target) return null;
  const req = target.request;
  const key = requestKey(req) + ':' + target.timezone;
  const finer = REPLAY_SUB_INTERVAL[req.interval];
  if (!finer) return null;
  if (replaySubBars && replaySubBars.key === key) return replaySubBars.bars;
  try {
    const bars = await fetchBars(req.symbol, finer, req.period, { slot: 'replay', timezone: target.timezone });
    if (!bars || bars.length === 0) return null;
    replaySubBars = { key, bars };
    return bars;
  } catch (_) {
    return null;
  }
}

/**
 * The mode marker. A chart replaying August looks exactly like a chart
 * showing today, and reading a live decision off history is the mistake this
 * exists to prevent, so it goes on while replay is on and comes off with it.
 */
export function showReplayMark(on) {
  const target = app.replayTarget;
  if (!TextWatermark || !target) return;
  if (on) {
    if (!target.mark) {
      target.mark = new TextWatermark({ text: 'Replay' });
      target.chart.addPrimitive(target.mark, 0);
    } else {
      target.mark.setOptions({ text: 'Replay' });
    }
  } else if (target.mark) {
    target.mark.setOptions({ text: '' });
  }
}

/**
 * Leave without asking. Used by the confirm dialog, and by anything that is
 * tearing the chart down anyway (a symbol or chart-type change), where a
 * prompt would be asking permission for something already decided.
 */
export function exitReplay(pane, destroyed = false) {
  if (pane !== undefined && pane !== app.replayTarget?.pane) return;
  cancelPick(destroyed);
  if (!app.replay) return;
  const target = app.replayTarget;
  if (destroyed) app.replay.pause();
  else app.replay.stop();
  app.replay = null;
  releaseTarget(destroyed);
  syncReplayAlertPause();
  el('replaybar').hidden = true;
  el('replaybar').innerHTML = '';
  el('replayleave').hidden = true;
  if (!destroyed && target) {
    const tail = target.series.getData().at(-1);
    const readout = readouts.get(target.chart) || (target.pane === 1 ? setLegend : null);
    readout?.(tail);
  }
  renderToolbar();
}

/**
 * The user-facing exit. Walking a session is work, and the playhead is the
 * only record of how far it got, so closing the mode confirms rather than
 * discarding it on a mis-click.
 */
export function askExitReplay() {
  if (app.replayPicking || app.replayLoading) { cancelPick(); return; }
  if (!app.replay) return;
  el('replayleave').hidden = false;
}

export function toggleReplayPlay() {
  if (!app.replay) return;
  if (app.replay.state().playing) app.replay.pause();
  else app.replay.play({ speed: replaySpeed });
}

export function cycleReplaySpeed() {
  const at = REPLAY_SPEEDS.indexOf(replaySpeed);
  replaySpeed = REPLAY_SPEEDS[(at + 1) % REPLAY_SPEEDS.length];
  // Re-speeding a running timer goes through play(); paused, the new speed
  // is simply what the next play() will use.
  if (app.replay && app.replay.state().playing) app.replay.play({ speed: replaySpeed });
  syncReplayBar();
}

/** Replay's clock: the bar time, with the clock only where the interval has one. */
export function barStamp(t) {
  const d = new Date(t * 1000);
  const target = owner();
  const timeZone = target?.timezone;
  const date = d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', timeZone });
  if (!/[mh]$/.test(target?.request.interval || '')) return date;
  return date + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
}

// Built once per replay session; syncReplayBar() then only writes the parts
// that move, so a drag on the scrub bar is not fighting a rebuild every frame.
export function buildReplayBar() {
  const bar = el('replaybar');
  bar.innerHTML = '';
  const btn = (icon, title, onClick, id, parent = bar) => {
    const b = document.createElement('button');
    b.innerHTML = ticon(icon);
    if (id) b.id = id;
    // The label is stored on the node, not captured here: syncReplayBar
    // rewrites play/pause and the step units as the transport moves.
    b.dataset.tip = title;
    b.setAttribute('aria-label', title);
    attachTip(b, () => ({ title: b.dataset.tip, side: 'top' }));
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  };

  const label = document.createElement('span');
  label.id = 'rp-owner';
  label.className = 'rcount';
  label.textContent = `Chart ${app.replayTarget?.pane || 1}`;
  bar.appendChild(label);
  btn('exit', 'Exit replay (puts the chart back)', askExitReplay);
  const actions = document.createElement('div');
  actions.className = 'rp-actions';
  bar.appendChild(actions);
  btn('stepback', 'Step back', () => app.replay && app.replay.stepBack(), 'rp-back', actions);
  btn('play', 'Play', toggleReplayPlay, 'rp-play', actions);
  btn('stepfwd', 'Step forward', () => app.replay && app.replay.step(), 'rp-fwd', actions);

  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.id = 'rp-scrub';
  scrub.min = '0';
  scrub.step = '1';
  scrub.title = 'Scrub the session';
  scrub.addEventListener('input', () => app.replay && app.replay.seek(Number(scrub.value)));
  bar.appendChild(scrub);

  const count = document.createElement('span');
  count.className = 'rcount';
  count.id = 'rp-count';
  bar.appendChild(count);
  const sub = document.createElement('span');
  sub.className = 'rsub';
  sub.id = 'rp-sub';
  bar.appendChild(sub);
  const clock = document.createElement('span');
  clock.className = 'rclock';
  clock.id = 'rp-clock';
  bar.appendChild(clock);

  const speed = document.createElement('button');
  speed.id = 'rp-speed';
  speed.title = 'Playback speed (click to cycle)';
  speed.addEventListener('click', cycleReplaySpeed);
  bar.appendChild(speed);
}

/** Everything the transport shows comes from one state() read. */
export function syncReplayBar() {
  if (!app.replay) return;
  const s = app.replay.state();
  const scrub = el('rp-scrub');
  if (scrub) {
    scrub.max = String(Math.max(0, s.total - 1));
    if (Number(scrub.value) !== s.index) scrub.value = String(s.index);
  }
  const count = el('rp-count');
  if (count) count.textContent = `${s.index + 1} / ${s.total}`;
  // Only shown when a bar actually takes more than one step, so a plain
  // whole-bar replay does not carry a permanent "1/1".
  const sub = el('rp-sub');
  if (sub) sub.textContent = s.subSteps > 1 ? `·  ${s.subIndex + 1}/${s.subSteps}` : '';
  const back = el('rp-back');
  const fwd = el('rp-fwd');
  const unit = s.subSteps > 1 ? 'one step of the forming bar' : 'one bar';
  if (back) { back.dataset.tip = 'Step back ' + unit; back.setAttribute('aria-label', back.dataset.tip); }
  if (fwd) { fwd.dataset.tip = 'Step forward ' + unit; fwd.setAttribute('aria-label', fwd.dataset.tip); }
  const clock = el('rp-clock');
  if (clock) clock.textContent = s.bar ? barStamp(s.bar.time) : '';
  const play = el('rp-play');
  if (play) {
    play.innerHTML = ticon(s.playing ? 'pause' : 'play');
    play.dataset.tip = s.playing ? 'Pause' : 'Play';
    play.setAttribute('aria-label', play.dataset.tip);
    play.classList.toggle('is-on', s.playing);
  }
  const speed = el('rp-speed');
  if (speed) speed.textContent = s.speed + 'x';
}

export function initReplay(a) {
  app = a;
  replayLoadRevision++;
  replaySubBars = null;
  controlHomes = ['replaybar', 'replaypick', 'replayleave'].map(id => { const node = el(id); return [node, node.parentNode]; });
  el('rp-pick-cancel').addEventListener('click', () => cancelPick());
  el('rp-leave-stay').addEventListener('click', () => { el('replayleave').hidden = true; });
  el('rp-leave-go').addEventListener('click', () => exitReplay());
  onEscape(() => {
    if (!el('replayleave').hidden) { el('replayleave').hidden = true; return; }
    if (app.replayPicking || app.replayLoading) cancelPick();
  }, document);
}
