"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { Bell } from "lucide-react";
import { markNotificationsReadAction } from "@/app/dashboard/actions";
import { formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface BellNotification {
  id: string;
  title: string;
  body: string;
  /** Only dashboard paths are kept; anything else is shown without a link. */
  link: string | null;
  createdAt: string;
  read: boolean;
}

/** The bell: unread count, and the last 30 notifications for this business. Opening it marks them read. */
export function NotificationBell({ unread, items, timezone }: { unread: number; items: BellNotification[]; timezone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && unread > 0) {
      void markNotificationsReadAction()
        .then((r) => r.ok && router.refresh())
        .catch(() => undefined);
    }
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="relative flex size-10 items-center justify-center rounded-full bg-card shadow-xs ring-1 ring-border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Bell className="size-5" aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="tabular absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-white"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 max-h-[min(28rem,75dvh)] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <DropdownMenu.Label className="px-3 py-2 text-sm font-semibold">Notifications</DropdownMenu.Label>
          {items.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted-foreground">No notifications yet. New requests and changes to bookings appear here.</p>
          ) : (
            items.map((n) => {
              const inner = (
                <>
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium">
                      {!n.read && <span className="sr-only">New: </span>}
                      {n.title}
                    </span>
                    {!n.read && <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>
                  <span className="tabular mt-1 block text-xs text-muted-foreground">{formatDay(n.createdAt, timezone)}, {formatTime(n.createdAt, timezone)}</span>
                </>
              );
              const cls = cn("block rounded-xl px-3 py-2.5 outline-none data-[highlighted]:bg-accent", !n.read && "bg-primary/5");
              return n.link?.startsWith("/dashboard/") ? (
                <DropdownMenu.Item key={n.id} asChild>
                  <Link href={n.link} className={cls}>
                    {inner}
                  </Link>
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item key={n.id} className={cls}>
                  {inner}
                </DropdownMenu.Item>
              );
            })
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
