"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export interface PulseState {
  pendingCount: number;
  unread: number;
  /** ISO time of the soonest live request deadline. */
  nextExpiryAt: string | null;
}

const POLL_MS = 20_000;

/**
 * Keeps the dashboard current without a reload. Polls the pulse endpoint and
 * re-renders the server pages when the request count or unread count moves,
 * and again when the next request deadline passes so it shows as expired.
 */
export function PulseWatcher(initial: PulseState) {
  const router = useRouter();
  const last = useRef(initial);
  last.current = initial;

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/dashboard/pulse", { cache: "no-store" });
        if (stopped) return;
        // Signed out or removed from the business: the server page decides what to show.
        if (res.status === 401 || res.status === 404) return router.refresh();
        if (!res.ok) return;
        const next = (await res.json()) as PulseState;
        if (next.pendingCount !== last.current.pendingCount || next.unread !== last.current.unread) router.refresh();
      } catch {
        // Offline for a moment: the next poll tries again.
      }
    };
    const id = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  const { nextExpiryAt } = initial;
  useEffect(() => {
    if (!nextExpiryAt) return;
    // A little after the deadline, so the server agrees it has passed.
    const wait = new Date(nextExpiryAt).getTime() - Date.now() + 1000;
    // Long waits are left to the regular poll; timers this long drift anyway.
    if (wait > 6 * 3_600_000) return;
    const id = setTimeout(() => router.refresh(), Math.max(wait, 0));
    return () => clearTimeout(id);
  }, [nextExpiryAt, router]);

  return null;
}
