"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Hourglass } from "lucide-react";
import { countdown } from "@/lib/format";
import { cn } from "@/lib/utils";

const URGENT_MS = 5 * 60_000;

/**
 * Time left for the venue to answer a request. Under five minutes it says so
 * in words as well as colour. When the deadline passes it asks the server to
 * re-render, so the request shows as expired and loses its buttons.
 */
export function ExpiryCountdown({ expiresAt, className }: { expiresAt: string; className?: string }) {
  const router = useRouter();
  const deadline = new Date(expiresAt);
  const [now, setNow] = useState(() => new Date());

  const left = deadline.getTime() - now.getTime();
  const expired = left <= 0;
  const urgent = !expired && left < URGENT_MS;

  useEffect(() => {
    if (expired) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [expired]);

  useEffect(() => {
    if (expired) router.refresh();
  }, [expired, router]);

  const Icon = urgent ? AlarmClock : Hourglass;
  return (
    <span
      role="timer"
      aria-live="off"
      data-urgent={urgent || undefined}
      className={cn(
        "tabular inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
        expired ? "bg-muted text-muted-foreground" : urgent ? "bg-destructive/10 font-semibold text-[#c4271d]" : "bg-warning/15 text-[#8a5300]",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span suppressHydrationWarning>
        {urgent && "Under 5 min · "}
        {expired ? "Deadline passed" : countdown(deadline, now)}
      </span>
    </span>
  );
}
