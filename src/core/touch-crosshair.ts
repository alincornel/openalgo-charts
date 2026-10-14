/**
 * The touch state the chart's input routing keeps beside its own gesture
 * state: the on-chart button a press landed on, and the crosshair a long press
 * summons on a device with no hover.
 *
 * Its own module because the rules are the fork's, not upstream's: a press on
 * a painted button is a tap and never a pan, a finger resting on the plot
 * summons a crosshair that outlives the gesture, and the next finger to land
 * steers it. `ChartInput` decides WHEN each of these happens; this holds what
 * they leave behind, so that state has one owner and one teardown.
 */

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

  /** Whether a long press is still waiting to fire. */
  public get pressing(): boolean {
    return this._timer !== null;
  }

  /** Start the long press; `fire` runs once the finger has rested long enough. */
  public arm(fire: () => void): void {
    this.clearPress();
    this._timer = setTimeout(() => {
      this._timer = null;
      fire();
    }, CROSSHAIR_PRESS_MS);
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

  /** The crosshair is gone: nothing summons, steers or keeps it any more. */
  public reset(): void {
    this.clearPress();
    this.release();
    this.sticky = false;
  }
}
