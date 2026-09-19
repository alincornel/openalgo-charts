import type { Bar } from '../model/bar';
import type { ChartDataContext } from '../model/indicator-registry';
import type { IndicatorApi } from '../model/indicator-instance';

/** A primary-source mutation, emitted after indicator invalidation. */
export interface ChartDataUpdate {
  kind: 'update' | 'reset' | 'prepend';
  time?: number;
}

/** Minimum headless chart surface needed to evaluate alerts. */
export interface AlertChartHost {
  primaryBars(): readonly Bar[];
  getDataContext(): Readonly<ChartDataContext> | undefined;
  on(event: string, callback: (payload: unknown) => void): () => void;
  emit(event: string, payload: unknown): void;
  /** Flushes computed study values. Only required by indicator-source alerts. */
  indicators?(): readonly Pick<IndicatorApi, 'id' | 'paneIndex' | 'series' | 'values'>[];
}

export type AlertCondition = 'crossing' | 'crossingUp' | 'crossingDown'
  | 'greaterThan' | 'lessThan' | 'enteringRange' | 'leavingRange' | 'matches';
export type AlertPolicy = 'onBarClose' | 'onTouch';
export type AlertRepeat = 'once' | 'everyTime';
export type AlertState = 'armed' | 'triggered' | 'expired' | 'disabled';

/** Prices are in primary-series units. Range conditions require upperPrice. */
export interface PriceAlertSource {
  kind: 'price';
  price: number;
  upperPrice?: number;
}

/** A threshold in plot units, anchored to one specific study instance. */
export interface IndicatorAlertSource {
  kind: 'indicator';
  instanceId: string;
  plotKey: string;
  value: number;
  upperValue?: number;
}

export interface BarConditionAlertSource {
  kind: 'barCondition';
  id: string;
}

export type AlertSource = PriceAlertSource | IndicatorAlertSource | BarConditionAlertSource;

/** Missing values, an absent anchor or a paused/context-mismatched chart are unavailable. */
export interface AlertAvailability {
  available: boolean;
  reason?: string;
  paneIndex?: number;
}

export interface BarConditionContext {
  /** Only the prefix through index is exposed, including for confirmed-bar checks. */
  bars: readonly Bar[];
  index: number;
}

export interface BarCondition {
  id: string;
  title: string;
  /** Runs at the alert's chosen policy, never for loaded history. */
  when(context: BarConditionContext): boolean;
}

/** An alert belongs to the instrument and interval present when it was armed. */
export interface AlertScope {
  symbol?: string;
  exchange?: string;
  interval?: string;
}

export interface AlertInput {
  id?: string;
  source: AlertSource;
  condition?: AlertCondition;
  /** Defaults to onBarClose. An intrabar touch may disappear from final history. */
  policy?: AlertPolicy;
  repeat?: AlertRepeat;
  state?: 'armed' | 'disabled';
  title?: string;
  message?: string;
  cooldownSeconds?: number;
  /** UTC seconds. At this instant the alert expires before it can trigger. */
  expiresAt?: number;
  /** Opaque host routing data. The controller never interprets or delivers it. */
  payload?: unknown;
}

export type AlertPatch = Partial<Omit<AlertInput, 'id'>>;

/** Lifecycle record. Snapshots detach mutable configuration, retaining opaque payloads. */
export interface Alert extends Omit<AlertInput, 'id' | 'condition' | 'policy' | 'repeat' | 'state' | 'title' | 'cooldownSeconds'> {
  id: string;
  condition: AlertCondition;
  policy: AlertPolicy;
  repeat: AlertRepeat;
  state: AlertState;
  title: string;
  cooldownSeconds: number;
  scope: AlertScope;
  lastTriggeredAt?: number;
  lastTriggeredTime?: number;
}

/** Shared delivery fields for trader and indicator-authored alerts. */
export interface AlertEventPayload {
  alertId: string;
  title: string;
  message?: string;
  /** Source bar UTC seconds and source index, not delivery wall-clock time. */
  time: number;
  index: number;
}

export interface AlertTriggeredPayload extends AlertEventPayload {
  price: number;
  alert: Alert;
}

export interface AlertControllerOptions {
  /** Delivery and expiry clock in UTC seconds. Defaults to Date.now() / 1000. */
  now?: () => number;
}
