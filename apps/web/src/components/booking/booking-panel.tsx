"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Minus, Plus, RotateCw } from "lucide-react";
import type { AvailabilityResult, ResourceAvailability, SlotView } from "@krello/booking-engine";
import { addDays, localDateOf } from "@krello/booking-engine/time";
import type { PublicBusiness } from "@krello/core";
import { quoteAction, submitRequestAction } from "@/app/(site)/[businessSlug]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingSummary, type QuoteState } from "./booking-summary";
import { DateStrip } from "./date-strip";
import { DetailsStep, type Contact, type SignedInUser } from "./details-step";
import { afterRefresh, clickSlot, readyToSend, windowInstants, type Selection } from "./selection";
import { SlotGrid } from "./slot-grid";

interface BookingPanelProps {
  business: PublicBusiness;
  /** The location the page opened on; the visitor can change it. */
  initialLocationId: string;
}

type Availability =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AvailabilityResult };

const REFRESH_MS = 30_000;
const MAX_GROUP = 50;
const OFFLINE = "We could not reach the server. Check your connection and try again.";

/** A fresh idempotency key. `crypto.randomUUID` needs a secure context, so fall back on plain http. */
function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Live availability, slot selection, price and the request itself. Every rule is
 * enforced again on the server; this only keeps the customer from building a
 * request the engine would refuse, and recovers when one is refused anyway.
 */
export function BookingPanel({ business, initialLocationId }: BookingPanelProps) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(
    () => (business.locations.find((l) => l.id === initialLocationId) ?? business.locations[0])?.id ?? "",
  );
  const location = business.locations.find((l) => l.id === locationId);
  const timezone = location?.timezone ?? "Asia/Kolkata";

  // Days from today (at the venue) to the furthest any resource here can be booked.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(localDateOf(new Date(), timezone)), [timezone]);
  const dates = useMemo(() => {
    if (!today || !location) return [];
    const furthest = Math.max(0, ...location.resources.map((r) => r.advanceDays));
    return Array.from({ length: furthest + 1 }, (_, i) => addDays(today, i));
  }, [today, location]);
  const [date, setDate] = useState<string | null>(null);
  const day = date && dates.includes(date) ? date : (dates[0] ?? null);

  const [availability, setAvailability] = useState<Availability>({ status: "loading" });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [groupSize, setGroupSize] = useState(2);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{ next: Selection; message: string } | null>(null);
  const [step, setStep] = useState<"pick" | "details">("pick");
  const [quote, setQuote] = useState<QuoteState>({ status: "loading" });
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [contact, setContact] = useState<Contact>({ name: "", email: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // One key per selection: retries of the same selection reuse it, so a double
  // submit or a retry after a dropped connection never makes a second booking.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const inFlight = useRef(false);

  const resources: ResourceAvailability[] = availability.status === "ready" ? availability.data.resources : [];

  /* ---------- who is signed in ---------- */
  useEffect(() => {
    let live = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { user: SignedInUser | null } | null) => {
        if (!live || !body?.user) return;
        setUser({ name: body.user.name, phone: body.user.phone });
        setContact((c) => (c.name ? c : { ...c, name: body.user!.name ?? "" }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  /* ---------- availability ---------- */
  const loadSeq = useRef(0);
  const load = useCallback(
    async (opts: { quiet?: boolean } = {}): Promise<ResourceAvailability[] | null> => {
      if (!locationId || !day) return null;
      const seq = ++loadSeq.current;
      if (!opts.quiet) setAvailability({ status: "loading" });
      try {
        const res = await fetch(`/api/public/availability?locationId=${encodeURIComponent(locationId)}&date=${day}`, { cache: "no-store" });
        const body = await res.json();
        if (seq !== loadSeq.current) return null;
        if (!res.ok) {
          if (!opts.quiet) setAvailability({ status: "error", message: body?.error?.message ?? "We could not load the slots." });
          return null;
        }
        setAvailability({ status: "ready", data: body as AvailabilityResult });
        return (body as AvailabilityResult).resources;
      } catch {
        if (seq === loadSeq.current && !opts.quiet) setAvailability({ status: "error", message: OFFLINE });
        return null;
      }
    },
    [locationId, day],
  );

  useEffect(() => {
    setSelection(null);
    setNotice(null);
    void load();
  }, [load]);

  // Fresh slots on return to the tab, and every 30 seconds while it is visible.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load({ quiet: true });
    };
    const id = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // Whenever the slots or the group size change, drop anything that is no longer
  // bookable and send the customer back to the grid to see what changed: a
  // request never goes out for a selection they have not seen priced.
  // A message already on screen (say, from a refused request) is kept.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    if (availability.status !== "ready") return;
    const r = afterRefresh(selectionRef.current, availability.data.resources, groupSize);
    if (!r.changed) return;
    setSelection(r.selection);
    setStep("pick");
    setNotice((current) => current ?? r.notice);
  }, [availability, groupSize]);

  // A changed selection is a different request, so it gets a new key.
  const selectionKey = selection ? `${locationId}|${day}|${selection.startMinute}-${selection.endMinute}|${[...selection.resourceIds].sort().join(",")}|${groupSize}` : "";
  useEffect(() => {
    setIdempotencyKey(newKey());
    setSubmitError(null);
    if (!selectionKey) setStep("pick");
  }, [selectionKey]);

  const instants = selection ? windowInstants(selection, resources, groupSize) : null;

  /* ---------- price ---------- */
  const quoteSeq = useRef(0);
  useEffect(() => {
    if (!selection || !instants) return;
    const seq = ++quoteSeq.current;
    const forKey = selectionKey;
    setQuote({ status: "loading" });
    const t = setTimeout(async () => {
      try {
        const result = await quoteAction({
          locationId,
          resourceIds: selection.resourceIds,
          startsAt: instants.startsAt,
          endsAt: instants.endsAt,
          groupSize,
        });
        if (seq !== quoteSeq.current) return;
        if (result.ok) setQuote({ status: "ready", quote: result.data, key: forKey });
        else {
          setQuote({ status: "error", message: result.message });
          if (result.code === "slot_conflict") void load({ quiet: true });
        }
      } catch {
        if (seq === quoteSeq.current) setQuote({ status: "error", message: OFFLINE });
      }
    }, 200);
    return () => clearTimeout(t);
    // The selection key captures every input to the quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, instants?.startsAt, instants?.endsAt]);

  /* ---------- selecting ---------- */
  function onSlot(r: ResourceAvailability, s: SlotView) {
    setNotice(null);
    const outcome = clickSlot(selection, resources, r, s, groupSize);
    if (outcome.kind === "confirm") setPendingReplace({ next: outcome.next, message: outcome.message });
    else {
      setSelection(outcome.selection);
      if (outcome.notice) setNotice(outcome.notice);
    }
  }

  /* ---------- sending ---------- */
  const canSend = readyToSend({ step, selectionKey, quote });
  // The OTP step finishes asynchronously, so submit() reads the latest render, not the one that started it.
  const latest = useRef({ canSend, selection, instants, groupSize, contact, idempotencyKey });
  latest.current = { canSend, selection, instants, groupSize, contact, idempotencyKey };

  async function submit() {
    const { canSend: ready, selection, instants, groupSize, contact, idempotencyKey } = latest.current;
    if (inFlight.current || !selection || !instants) return;
    if (!ready) {
      setSubmitError("Your selection or its price has changed. Check the summary, then send your request.");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitRequestAction({
        locationId,
        resourceIds: selection.resourceIds,
        startsAt: instants.startsAt,
        endsAt: instants.endsAt,
        groupSize,
        name: contact.name,
        email: contact.email,
        notes: contact.notes,
        idempotencyKey,
      });
      if (result.ok) {
        setIdempotencyKey(newKey());
        router.push(result.data.statusUrl);
        return;
      }
      if (result.code === "auth_required") {
        setUser(null);
        setSubmitError("Your session has ended. Verify your phone number to send the request.");
      } else if (result.code === "slot_conflict") {
        // Someone else got there first. Show the fresh slots; keep the customer's details.
        // The re-fetch below prunes only the items that were taken.
        setNotice(result.message);
        setStep("pick");
        await load({ quiet: true });
      } else {
        setSubmitError(result.message);
      }
    } catch {
      setSubmitError(OFFLINE);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  /* ---------- render ---------- */
  const multi = business.locations.length > 1;
  const canContinue = !!selection && quote.status === "ready";

  return (
    <section
      aria-labelledby="book-heading"
      // The panel is sticky beside the page on wide screens; it scrolls inside itself so Continue is always reachable.
      className="rounded-card border bg-card p-4 shadow-sm sm:p-6 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain"
    >
      <div className="flex items-center gap-2">
        {step === "details" && (
          <Button type="button" variant="ghost" size="icon-sm" className="-ml-2 rounded-full" aria-label="Back to slots" onClick={() => setStep("pick")}>
            <ChevronLeft />
          </Button>
        )}
        <h2 id="book-heading" className="text-lg font-semibold tracking-tight">
          {step === "pick" ? "Book a slot" : "Your details"}
        </h2>
      </div>

      {step === "pick" && (
        <div className="mt-4 flex flex-col gap-4">
          {multi && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-location">Location</Label>
              <select
                id="booking-location"
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setDate(null);
                }}
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {business.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name === l.locality ? l.name : `${l.name}, ${l.locality}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {dates.length > 0 && day && <DateStrip dates={dates} value={day} onChange={setDate} />}

          <div className="flex items-center justify-between gap-3">
            <span id="group-label" className="text-sm font-medium">
              People
            </span>
            <div role="group" aria-labelledby="group-label" className="flex items-center gap-1 rounded-full border p-0.5">
              <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label="Fewer people" disabled={groupSize <= 1} onClick={() => setGroupSize((n) => Math.max(1, n - 1))}>
                <Minus />
              </Button>
              <output aria-live="polite" className="tabular w-8 text-center text-[15px] font-semibold">
                {groupSize}
              </output>
              <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label="More people" disabled={groupSize >= MAX_GROUP} onClick={() => setGroupSize((n) => Math.min(MAX_GROUP, n + 1))}>
                <Plus />
              </Button>
            </div>
          </div>

          {notice && (
            <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              {notice}
            </p>
          )}

          <SlotsArea availability={availability} groupSize={groupSize} selection={selection} onSlot={onSlot} onRetry={() => void load()} />

          {selection && instants && (
            <>
              <BookingSummary
                startsAt={instants.startsAt}
                endsAt={instants.endsAt}
                timezone={timezone}
                groupSize={groupSize}
                quote={quote}
                holdMinutes={business.policy.pendingHoldMinutes}
                policyLines={business.policyLines}
              />
              <Button type="button" size="lg" className="h-11 rounded-full text-[15px]" disabled={!canContinue} onClick={() => setStep("details")}>
                Continue
              </Button>
            </>
          )}
        </div>
      )}

      {/* Stays mounted on the slot step, so a half-finished phone check survives a trip back to the grid. */}
      <div hidden={step !== "details"} className="mt-4 flex-col gap-4 [&:not([hidden])]:flex">
        {notice && (
          <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        {selection && instants && (
          <BookingSummary
            startsAt={instants.startsAt}
            endsAt={instants.endsAt}
            timezone={timezone}
            groupSize={groupSize}
            quote={quote}
            holdMinutes={business.policy.pendingHoldMinutes}
            policyLines={business.policyLines}
          />
        )}
        <DetailsStep
          user={user}
          contact={contact}
          onContactChange={setContact}
          submitting={submitting}
          canSend={canSend}
          error={submitError}
          onSubmit={() => void submit()}
          onVerified={(u) => {
            setUser(u);
            setSubmitError(null);
            void submit();
          }}
        />
      </div>

      <Dialog open={!!pendingReplace} onOpenChange={(open) => !open && setPendingReplace(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start a new selection?</DialogTitle>
            <DialogDescription>{pendingReplace?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setPendingReplace(null)}>
              Keep current
            </Button>
            <Button
              type="button"
              className="rounded-full"
              onClick={() => {
                if (pendingReplace) setSelection(pendingReplace.next);
                setPendingReplace(null);
              }}
            >
              Start new selection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SlotsArea({
  availability,
  groupSize,
  selection,
  onSlot,
  onRetry,
}: {
  availability: Availability;
  groupSize: number;
  selection: Selection | null;
  onSlot: (r: ResourceAvailability, s: SlotView) => void;
  onRetry: () => void;
}) {
  if (availability.status === "loading") {
    return (
      <div className="space-y-1.5" aria-busy="true" aria-label="Loading slots">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[3.75rem] w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (availability.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-xl bg-muted/60 p-4 text-sm">
        <p>{availability.message}</p>
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onRetry}>
          <RotateCw />
          Try again
        </Button>
      </div>
    );
  }
  const withSlots = availability.data.resources.filter((r) => r.slots.length > 0);
  if (!withSlots.length) {
    return <p className="rounded-xl bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">No slots on this day. Try another date.</p>;
  }
  const anyOpen = withSlots.some((r) => r.slots.some((s) => s.state === "available"));
  return (
    <div className="flex flex-col gap-2">
      <SlotGrid resources={withSlots} selection={selection} groupSize={groupSize} onSlot={onSlot} />
      {!anyOpen && <p className="text-sm text-muted-foreground">Everything is taken on this day. Try another date.</p>}
      <p className="text-xs text-muted-foreground">Pick one or more slots in a row. To book several tables, pick the same time on each.</p>
    </div>
  );
}
