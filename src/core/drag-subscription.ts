/**
 * `Chart.subscribeDrag`, with the fork's third outcome: a drag TAKEN AWAY (a
 * pinch, a `pointercancel`, Escape on an opt-in draft) rather than released.
 *
 * A host that holds a line at the pointer's price for the length of a drag
 * (an order being moved) has to hear that the drag is over without a price
 * being chosen, or the line keeps the finger's price for as long as it lives.
 * A subscription that passes `onDragCancel` gets exactly that; one that does
 * not keeps upstream's behaviour: the legacy release at the pointer's price
 * for a `pointercancel`, and nothing for a pinch or Escape.
 */
import { subscribe } from '../helpers/dispatch';

/**
 * One call to a `subscribeDrag` subscription: a move, or the release. One
 * entry per subscription, rather than one per callback, so unsubscribing is
 * one removal.
 */
export interface SubscribedDrag {
  end: boolean; id: string; price: number; time: number;
  /** A drag taken away: `onDragCancel`, else the legacy release ('release', a `pointercancel`) or nothing ('silent'). */
  cancelled?: 'release' | 'silent';
}

/** The input routing's two subscriber sets: every subscription, and those that understand a cancel. */
export interface DragSubscribers {
  readonly _dragCbs: Set<(drag: SubscribedDrag) => void>;
  readonly _dragCancelAware: Set<(drag: SubscribedDrag) => void>;
}

export function subscribeDrag(
  subscribers: DragSubscribers,
  onDrag: (externalId: string, price: number, time: number) => void,
  onDragEnd?: (externalId: string, price: number, time: number) => void,
  onDragCancel?: (externalId: string) => void,
): () => void {
  const entry = (d: SubscribedDrag): void => {
    if (d.cancelled === undefined) (d.end ? onDragEnd : onDrag)?.(d.id, d.price, d.time);
    else if (onDragCancel) onDragCancel(d.id);
    else if (d.cancelled === 'release') onDragEnd?.(d.id, d.price, d.time);
  };
  // A cancel-aware subscription is what tells a `pointercancel` to send no `drag:end`.
  if (onDragCancel) subscribers._dragCancelAware.add(entry);
  const off = subscribe(subscribers._dragCbs, entry);
  return (): void => { off(); subscribers._dragCancelAware.delete(entry); };
}
