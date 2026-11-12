import {
  Ban,
  CheckCheck,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Hourglass,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { STATUS_LABEL, type BookingStatus } from "@krello/booking-engine/labels";
import { cn } from "@/lib/utils";

export type PaymentStatus = "unpaid" | "partially_paid" | "paid";

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partly paid",
  paid: "Paid",
};

const BASE = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium";

const GREEN = "bg-success/15 text-[#1b7a35]";
const ORANGE = "bg-warning/15 text-[#8a5300]";
const RED = "bg-destructive/10 text-[#c4271d]";
const BLUE = "bg-info/10 text-[#0058b0]";
const GREY = "bg-muted text-muted-foreground";

const BOOKING_STYLE: Record<BookingStatus, { icon: LucideIcon; tone: string }> = {
  pending: { icon: Hourglass, tone: ORANGE },
  approved: { icon: CircleCheck, tone: GREEN },
  rejected: { icon: CircleX, tone: RED },
  expired: { icon: Ban, tone: GREY },
  cancelled_by_customer: { icon: Ban, tone: GREY },
  cancelled_by_business: { icon: Ban, tone: RED },
  completed: { icon: CheckCheck, tone: BLUE },
  no_show: { icon: UserX, tone: RED },
};

const PAYMENT_STYLE: Record<PaymentStatus, { icon: LucideIcon; tone: string }> = {
  unpaid: { icon: CircleDashed, tone: GREY },
  partially_paid: { icon: CircleDot, tone: ORANGE },
  paid: { icon: CircleCheck, tone: GREEN },
};

/** Booking status. The text label always shows: colour is never the only signal. */
export function StatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  const { icon: Icon, tone } = BOOKING_STYLE[status];
  return (
    <span className={cn(BASE, tone, className)} data-status={status}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Payment status, separate from booking status. */
export function PaymentBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  const { icon: Icon, tone } = PAYMENT_STYLE[status];
  return (
    <span className={cn(BASE, tone, className)} data-payment-status={status}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {PAYMENT_LABEL[status]}
    </span>
  );
}
