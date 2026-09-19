# Trader-created alerts

`AlertController` is a headless base export. Construct one per chart. It owns
evaluation and expiry, while the host owns notification, sound or webhook
delivery. No event sends an order. `chart.destroy()` destroys its controller;
explicit `alerts.destroy()` unsubscribes and releases the chart for a new owner.

```ts
import { AlertController, type AlertTriggeredPayload } from 'openalgo-charts';

chart.setDataContext({ symbol: 'CONTRACT', exchange: 'DERIVATIVES', interval: '1m' });
const alerts = new AlertController(chart);
const record = alerts.add({
  source: { kind: 'price', price: 100 },
  condition: 'crossingUp',
  policy: 'onBarClose',
  repeat: 'once',
  message: 'Confirmed close crossed the level',
  payload: { route: 'host-owned' },
});
const off = chart.on('alert:triggered', value => {
  const event = value as AlertTriggeredPayload;
  showNotification(event.message ?? event.title);
});
alerts.disable(record.id);
alerts.enable(record.id);
alerts.update(record.id, { source: { kind: 'price', price: 110 } });
alerts.remove(record.id);
off();
```

## Model and methods

`AlertInput` accepts an optional unique id, `AlertSource`, `AlertCondition`,
`AlertPolicy`, `AlertRepeat`, initial armed/disabled state, title, message,
nonnegative cooldownSeconds, UTC-seconds expiresAt, and opaque payload.
The current price source is `{ kind: 'price', price, upperPrice? }`.
`AlertScope` captures symbol, exchange and interval from chart data context.
Set that context before creating alerts; alerts do not migrate to a new market.

`Alert` is the normalized record, with a required id, defaults, scope,
`AlertState` and optional lastTriggeredAt (UTC delivery seconds) and
lastTriggeredTime (bar UTC seconds). `AlertState` is armed, triggered, disabled
or expired. Once alerts stay visible as triggered. Every-time alerts stay armed.
`list()` and returned records detach mutable configuration; payload remains
opaque and retains its original reference.

`add(input)` returns an Alert. `update(id, AlertPatch)`, `enable(id)` and
`disable(id)` return the changed Alert or undefined for an unknown id.
`remove(id)` returns whether it removed a record. `setPaused(boolean)` controls
an explicit host pause independently of replay. Resuming seeds observations
silently. Unknown ids do not create records. Invalid edits are rejected before
changing the stored record. Duplicate controllers on one chart are rejected.

`AlertControllerOptions.now` optionally supplies a clock in UTC seconds for
expiry and cooldown, defaulting to Date.now()/1000. One timer follows the next
armed expiry, including on an idle feed. Disabled and once-triggered records do
not keep an expiry timer. Destruction cancels it.
`AlertChartHost` is the structural chart interface, allowing a host integration
without a nominal dependency on a specific bundled Chart class.

## Conditions and timing

`AlertCondition` accepts crossing, crossingUp, crossingDown, greaterThan,
lessThan, enteringRange and leavingRange. Range conditions require two finite,
ordered bounds; boundaries count as inside. Closed crossing-up uses previous
close <= price and confirmed close > price; crossing-down uses the inverse.
Zero is a valid threshold. Non-finite thresholds and negative cooldowns fail.

`AlertPolicy` defaults to onBarClose. The next live primary bar confirms the
previous tail, and the controller evaluates that closed bar, never history
loaded through setData or prependData. `AlertRepeat` defaults to once.

onTouch observes newly reached extrema and the path between observed closes.
A wick already present when arming or resuming is not a fresh touch. An intrabar
trigger may disappear from the final candle: choose this policy explicitly when
that tradeoff is intended. At most one match per alert/bar is consumed, even if
cooldown suppresses delivery. An old wick cannot trigger when cooldown expires.

Replay, context mismatches, late historical updates and history loads suppress
delivery. Moving history backwards does not make a consumed bar new again.
At or after expiresAt, expiry takes priority over a new trigger.

## Events

| Event | Payload |
| --- | --- |
| alert:created | `{ alert: Alert }` after creation |
| alert:updated | `{ alert: Alert }` after editing, enabling or disabling |
| alert:removed | `{ alert: Alert, reason: 'removed' }` |
| alert:expired | `{ alert: Alert }` when an armed record expires |
| alert:triggered | `AlertTriggeredPayload`: alertId, title, message, time, index, price, alert |

The trigger time and index identify the source bar, not the delivery clock.
Closed triggers report its close. Intrabar crossing triggers report the crossed
threshold; greater/less report the observed extremum. State and duplicate guards
are committed before callbacks. Listeners may remove another alert, change
context or destroy the chart. The chart bus isolates throwing listeners; log
delivery failures in the host. Existing indicator:alert behavior is preserved.
