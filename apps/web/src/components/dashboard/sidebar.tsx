"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Inbox, LayoutGrid, ListChecks, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SidebarItemKey = "overview" | "requests" | "bookings" | "calendar" | "payments";

const ITEMS: { key: SidebarItemKey; href: string; label: string; icon: LucideIcon }[] = [
  { key: "overview", href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { key: "requests", href: "/dashboard/requests", label: "Requests", icon: Inbox },
  { key: "bookings", href: "/dashboard/bookings", label: "Bookings", icon: ListChecks },
  { key: "calendar", href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { key: "payments", href: "/dashboard/payments", label: "Payments", icon: Wallet },
];

function isCurrent(href: string, pathname: string) {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Dashboard navigation: a column beside the page on wide screens, a scrolling
 * strip under the header on phones. The server decides which items the
 * member's role may open; hidden ones are not rendered at all.
 */
export function Sidebar({ items, pendingCount }: { items: SidebarItemKey[]; pendingCount: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex gap-1 md:flex-col">
        {ITEMS.filter((i) => items.includes(i.key)).map(({ key, href, label, icon: Icon }) => {
          const current = isCurrent(href, pathname);
          return (
            <li key={key} className="shrink-0">
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-2.5 whitespace-nowrap rounded-full px-3.5 text-[15px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 md:rounded-xl",
                  current ? "bg-card text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
                )}
              >
                <Icon className="size-4.5 shrink-0" aria-hidden="true" />
                {label}
                {key === "requests" && pendingCount > 0 && (
                  <span className="tabular ml-auto rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-[#3d2500]">
                    {pendingCount}
                    <span className="sr-only"> waiting</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
