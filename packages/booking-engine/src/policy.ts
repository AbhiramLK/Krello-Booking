/** Booking rules a business can configure. Stored in businesses.policy. */
export interface BusinessPolicy {
  /** How long an online request holds its slots while awaiting a decision. */
  pendingHoldMinutes: number;
  customerCanCancelPending: boolean;
  customerCanCancelApproved: boolean;
  /** Customers may cancel an approved booking until this long before it starts. */
  cancellationDeadlineMinutes: number;
  cancellationReasonRequired: boolean;
}

export const DEFAULT_POLICY: BusinessPolicy = {
  pendingHoldMinutes: 30,
  customerCanCancelPending: true,
  customerCanCancelApproved: true,
  cancellationDeadlineMinutes: 120,
  cancellationReasonRequired: false,
};

export function resolvePolicy(raw: unknown): BusinessPolicy {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof BusinessPolicy, unknown>>;
  const num = (v: unknown, d: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    pendingHoldMinutes: num(r.pendingHoldMinutes, DEFAULT_POLICY.pendingHoldMinutes, 5, 24 * 60),
    customerCanCancelPending: bool(r.customerCanCancelPending, DEFAULT_POLICY.customerCanCancelPending),
    customerCanCancelApproved: bool(r.customerCanCancelApproved, DEFAULT_POLICY.customerCanCancelApproved),
    cancellationDeadlineMinutes: num(
      r.cancellationDeadlineMinutes,
      DEFAULT_POLICY.cancellationDeadlineMinutes,
      0,
      30 * 24 * 60,
    ),
    cancellationReasonRequired: bool(r.cancellationReasonRequired, DEFAULT_POLICY.cancellationReasonRequired),
  };
}

export function describeDuration(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}

/** Plain-language summary shown to customers before they submit. */
export function describePolicy(p: BusinessPolicy): string[] {
  const lines = [
    `Your request holds the slot for up to ${describeDuration(p.pendingHoldMinutes)} while the venue decides. If the venue does not respond in time, the request expires and the slot is released.`,
  ];
  lines.push(
    p.customerCanCancelPending
      ? "You can cancel a request any time before the venue responds."
      : "A request cannot be cancelled online once submitted. Call the venue instead.",
  );
  if (p.customerCanCancelApproved) {
    const when =
      p.cancellationDeadlineMinutes === 0
        ? "any time before it starts"
        : `up to ${describeDuration(p.cancellationDeadlineMinutes)} before it starts`;
    lines.push(`You can cancel a confirmed booking ${when}.`);
  } else {
    lines.push("Confirmed bookings cannot be cancelled online. Call the venue instead.");
  }
  lines.push("You pay at the venue. Nothing is charged online.");
  return lines;
}
