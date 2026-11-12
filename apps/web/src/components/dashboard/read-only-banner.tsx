import { Lock } from "lucide-react";

/** Shown across the dashboard while the subscription has lapsed. Action buttons are disabled meanwhile. */
export function ReadOnlyBanner() {
  return (
    <div role="status" className="border-b bg-warning/15 px-4 py-3 text-[15px] text-[#5c3800] sm:px-6">
      <p className="mx-auto flex max-w-5xl items-start gap-2">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>Read-only: your subscription has expired. Renew to manage bookings.</span>
      </p>
    </div>
  );
}
