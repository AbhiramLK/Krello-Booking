export type EngineErrorCode =
  | "slot_conflict"
  | "not_found"
  | "invalid_transition"
  | "validation"
  | "policy"
  | "not_bookable"
  | "read_only"
  | "limit"
  | "idempotency_conflict"
  | "payment_exceeds_due";

const STATUS: Record<EngineErrorCode, number> = {
  slot_conflict: 409,
  not_found: 404,
  invalid_transition: 409,
  validation: 422,
  policy: 403,
  not_bookable: 403,
  read_only: 403,
  limit: 429,
  idempotency_conflict: 409,
  payment_exceeds_due: 422,
};

/** An expected, user-facing failure. `message` is safe to show. */
export class EngineError extends Error {
  readonly status: number;
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EngineError";
    this.status = STATUS[code];
  }
}

export function isEngineError(e: unknown): e is EngineError {
  return e instanceof EngineError;
}
