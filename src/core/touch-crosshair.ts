/**
 * What a finger gets on the chart that a mouse does not: a press on an
 * on-chart button is a tap and never a pan, a finger resting on the plot
 * summons a crosshair that outlives the gesture, and the next finger to land
 * steers it.
 *
 * Its own module because the rules are the fork's, not upstream's, and
 * because the input routing they extend (chart-input.ts) sits at the source
 * file length limit. `ChartInput` calls in at the press, the move, the release
 * and the teardown; this reads and drives the input state it needs through
 * `TouchInput`, the way upstream's collaborators reach the chart through a
 * host interface.
 */
import { InvalidationLevel } from './invalidate-mask';
import { dispatch } from '../helpers/dispatch';

/**
 * How far a press on an on-chart button may travel and still count as a tap,
 * in media px. Sized for a thumb rather than a mouse: a finger rolls several
 * pixels between contact and release without the person meaning to move.
 */
export const TAP_SLOP = 12;

/**
 * How long a finger has to rest before it summons the crosshair, in ms. A
 * touch device has no hover, so a press is the only gesture left that can mean
 * "tell me about this point" rather than "move the chart", and every mobile
 * chart in existence spends the long press on exactly that.
 */
export const CROSSHAIR_PRESS_MS = 450;

/** How far the finger may travel before the press is a pan, not a long press. */
export const CROSSHAIR_PRESS_SLOP = 10;

/**
 * The slice of `ChartInput` these gestures read and drive. Declared
 * structurally, not as `ChartInput['_x']`, so this module stays out of the
 * input routing's type import cycle; `ChartInput` passes itself and the
 * compiler checks it against this shape there.
 */
export interface TouchInput {
  readonly _host: {
    readonly _destroyed: boolean;
    readonly _indicators: readonly { updateLegendValues(): void }[];
    _dragVelocity: number;
    _ensureScaled(paneIndex: number): void;
    invalidate(mutate: (mask: { invalidateGlobal(level: InvalidationLevel): void }) => void): void;
    _emit(event: 'crosshair:readout' | 'crosshair:move', payload: CrosshairCleared): void;
  };
  readonly _pointers: ReadonlyMap<number, unknown>;
  readonly _crosshairCbs: Iterable<(e: CrosshairCleared) => void>;
  readonly _downX: number;
  readonly _downLocalY: number;
  _dragging: boolean;
  _pointerMoved: boolean;
  _cursor: { x: number; y: number } | null;
  _cursorPane: number | null;
  _setHover(hit: TouchHit | null): void;
  _updateCursor(paneIndex: number, x: number, localY: number, containerY: number, source: PointerEvent): void;
  _movedFromPress(x: number, localY: number): boolean;
}

/** The crosshair event a hidden crosshair sends: every field null. */
interface CrosshairCleared {
  time: null; index: null; price: null; bar: null; point: null; paneIndex: null;
}

/** The part of a primitive hit a press reads: what it is, and whether it is a button. */
interface TouchHit { readonly externalId: string; readonly cursor?: string | undefined }

/** A pointer projected onto the pane under it, as the input routing reads it. */
interface TouchPoint { x: number; y: number; pane: number; localY: number }

export class TouchCrosshair {
  /**
   * The button-like primitive a press landed on (a pill segment, a cancel x, a
   * legend control), held until the release decides whether it was a tap.
   */
  public tapId: string | null = null;
  /** The pointer currently steering the crosshair, if one is down. */
  public pointer: number | null = null;
  /** True when the steering finger ADOPTED a crosshair rather than summoning it. */
  public adopted = false;
  /**
   * A touch crosshair is on screen and outlives the gesture that summoned it.
   *
   * Sticky on purpose. The crosshair exists so the trader can read a level and
   * then act on it, and anything he acts WITH (a price-axis button, a host's
   * own control) has to still be there once the finger is off the glass. A
   * crosshair that vanished on lift could be read and never used.
   */
  public sticky = false;
  /** Pending long-press timer, while a finger is resting on the plot. */
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private readonly _in: TouchInput;

  public constructor(input: TouchInput) {
    this._in = input;
  }

  /** Whether a long press is still waiting to fire. */
  public get pressing(): boolean {
    return this._timer !== null;
  }

  /** Drop a pending long press; the gesture turned out to be something else. */
  public clearPress(): void {
    if (this._timer === null) return;
    clearTimeout(this._timer);
    this._timer = null;
  }

  /** The steering finger lets go of the crosshair; the crosshair itself stays. */
  public release(): void {
    this.pointer = null;
    this.adopted = false;
  }

  /**
   * A press that is not a primitive drag: a tap on an on-chart button (never a
   * pan: a thumb that rolls must not scroll the chart and lose the click), a
   * finger adopting a crosshair already up, or the start of the long press
   * that summons one. True when the press is taken.
   */
  public beginPress(e: PointerEvent, p: TouchPoint, hit: TouchHit | null | undefined): boolean {
    const input = this._in;
    if (hit?.cursor === 'pointer') {
      this.tapId = hit.externalId;
      // Touch has no hover: this is the only sign the finger landed on the button.
      input._setHover(hit);
      input._dragging = false;
      input._pointerMoved = false;
      return true;
    }
    if (e.pointerType === 'mouse') return false;
    if (this.sticky) {
      // The next finger steers a crosshair already on screen. Adopted, not
      // summoned: on release a still finger means "put it away".
      this.pointer = e.pointerId;
      this.adopted = true;
      input._dragging = false;
      input._pointerMoved = false;
      input._host._dragVelocity = 0;
      input._host._ensureScaled(p.pane);
      input._updateCursor(p.pane, p.x, p.localY, p.y, e);
      return true;
    }
    this.clearPress();
    const pointerId = e.pointerId;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (!input._pointers.has(pointerId) || input._host._destroyed) return;
      this.pointer = pointerId;
      this.sticky = true;
      this.adopted = false;
      // The pan this press armed is abandoned, not finished: half a pan left
      // behind would fling the chart on release.
      input._dragging = false;
      input._pointerMoved = true;
      input._host._dragVelocity = 0;
      // Measured before the y is read as a price, as every such path does.
      input._host._ensureScaled(p.pane);
      input._updateCursor(p.pane, p.x, p.localY, p.y, e);
    }, CROSSHAIR_PRESS_MS);
    return false;
  }

  /** A move: a tap past its slop, a long press past its own, a crosshair steer. True when taken. */
  public move(e: PointerEvent, p: TouchPoint): boolean {
    const input = this._in;
    const dx = Math.abs(p.x - input._downX), dy = Math.abs(p.localY - input._downLocalY);
    if (this.tapId !== null && (dx > TAP_SLOP || dy > TAP_SLOP)) {
      this.tapId = null;
      input._pointerMoved = true;
      input._setHover(null);
    }
    if (this.pressing && (dx > CROSSHAIR_PRESS_SLOP || dy > CROSSHAIR_PRESS_SLOP)) this.clearPress();
    if (this.pointer !== e.pointerId) return false;
    // Steering suspends the pan, and counts as movement, so the release keeps
    // the crosshair where it was aimed instead of dismissing it.
    if (input._movedFromPress(p.x, p.localY)) input._pointerMoved = true;
    input._updateCursor(p.pane, p.x, p.localY, p.y, e);
    return true;
  }

  /** A release: the crosshair finger lifting, or a tap ending. True when taken. */
  public end(e: PointerEvent, cancelled: boolean): boolean {
    if (this.pointer === e.pointerId) {
      // The crosshair outlives the finger. Nothing else about this gesture
      // happens, or the lift would also click whatever is under it.
      const adopted = this.adopted;
      this.release();
      if (adopted && !this._in._pointerMoved && !cancelled) this.hide();
      return true;
    }
    if (this.tapId !== null) {
      this.tapId = null;
      // A finger off the glass hovers nothing: drop the pressed look.
      if (e.pointerType !== 'mouse') this._in._setHover(null);
    }
    return false;
  }

  /**
   * `Chart.hideCrosshair`: the crosshair off every pane, announced the way a
   * mouse leaving the plot announces it. Touch has no pointerleave, so a host
   * that acts on the crosshair needs this to put it away.
   */
  public hide(): void {
    const input = this._in;
    this.clearPress();
    this.release();
    this.sticky = false;
    if (input._cursor === null) return;
    input._cursor = null;
    input._cursorPane = null;
    // clear the crosshair from every pane (global vertical line)
    input._host.invalidate((m) => m.invalidateGlobal(InvalidationLevel.Cursor));
    // No crosshair: legends fall back to the latest bar.
    for (const indicator of input._host._indicators) indicator.updateLegendValues();
    const cleared = { time: null, index: null, price: null, bar: null, point: null, paneIndex: null };
    dispatch(input._crosshairCbs, cleared);
    input._host._emit('crosshair:readout', cleared);
    input._host._emit('crosshair:move', cleared);
  }
}
