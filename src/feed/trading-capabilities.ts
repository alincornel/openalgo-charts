import type { OrderType } from './types';

export type TradingOperation = 'place' | 'modify' | 'cancel';

/** Optional restrictions on existing write paths; omissions preserve legacy support. */
export interface TradingCapabilities {
  readonly place?: boolean | 'unknown';
  readonly modify?: boolean | 'unknown';
  readonly cancel?: boolean | 'unknown';
  /** Accepted types for new orders. An empty list disables placement. */
  readonly orderTypes?: readonly OrderType[];
  /** Accepted modes for new orders; does not change the broker's actual mode. */
  readonly modes?: readonly ('live' | 'analyzer')[];
}

export interface TradingCapabilityRequest {
  readonly operation: TradingOperation;
  readonly symbol?: string;
  readonly exchange?: string;
  readonly orderId?: string;
  readonly type?: OrderType;
  readonly mode?: 'live' | 'analyzer';
}

/** A configured provider returning undefined declares that support is unavailable. */
export type TradingCapabilitySource = TradingCapabilities
  | ((request: Readonly<TradingCapabilityRequest>) => TradingCapabilities | undefined);

export type TradingCapabilityResult = { supported: true } | { supported: false; reason: string };

/** Shared by host controls and the write boundary. Never grants broker authority. */
export function checkTradingCapability(
  source: TradingCapabilitySource | undefined,
  request: TradingCapabilityRequest,
): TradingCapabilityResult {
  if (source === undefined) return { supported: true };
  try {
    const capabilities = typeof source === 'function' ? source(Object.freeze({ ...request })) : source;
    if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities) || 'then' in capabilities) {
      return { supported: false, reason: 'Trading capabilities are unavailable' };
    }
    const support = capabilities[request.operation];
    if (support === false) return { supported: false, reason: `Trading operation ${request.operation} is not supported` };
    if (support !== undefined && support !== true) {
      return { supported: false, reason: `Support for trading operation ${request.operation} is unknown` };
    }
    // Placement restrictions cannot strand an existing order that remains cancellable.
    if (request.operation === 'place') {
      if (capabilities.orderTypes !== undefined) {
        if (!Array.isArray(capabilities.orderTypes) || request.type === undefined) {
          return { supported: false, reason: 'Supported order types are unavailable for this request' };
        }
        if (!capabilities.orderTypes.includes(request.type)) {
          return { supported: false, reason: `Order type ${request.type} is not supported` };
        }
      }
      if (capabilities.modes !== undefined) {
        if (!Array.isArray(capabilities.modes) || request.mode === undefined) {
          return { supported: false, reason: 'Supported trading modes are unavailable for this request' };
        }
        if (!capabilities.modes.includes(request.mode)) {
          return { supported: false, reason: `Trading mode ${request.mode} is not supported` };
        }
      }
    }
    return { supported: true };
  } catch {
    return { supported: false, reason: 'Trading capabilities are unavailable' };
  }
}

/** Raised only before delivery, so an unsupported write does not become ambiguous. */
export class TradingCapabilityError extends Error {
  public readonly preflight = true as const;
  public readonly operation: TradingOperation;

  public constructor(operation: TradingOperation, reason: string) {
    super(reason);
    this.name = 'TradingCapabilityError';
    this.operation = operation;
  }
}

export function assertTradingCapability(source: TradingCapabilitySource | undefined, request: TradingCapabilityRequest): void {
  const result = checkTradingCapability(source, request);
  if (!result.supported) throw new TradingCapabilityError(request.operation, result.reason);
}
