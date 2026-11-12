import type { Metadata } from "next";
import Link from "next/link";
import { getPulse, listMemberships, listNotifications, maskPhone, type Permission } from "@krello/core";
import { BusinessSwitcher } from "@/components/dashboard/business-switcher";
import { NotificationBell } from "@/components/dashboard/notification-bell";
import { PulseWatcher } from "@/components/dashboard/pulse-watcher";
import { ReadOnlyBanner } from "@/components/dashboard/read-only-banner";
import { Sidebar, type SidebarItemKey } from "@/components/dashboard/sidebar";
import { UserMenu } from "@/components/user-menu";
import { getDb } from "@/lib/db";
import { requireTenant } from "@/lib/session";
import { getWritable, primaryTimezone } from "./tenant";

// Private pages: kept out of search results and, in robots.ts, out of crawling.
export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Dashboard | Krello" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Which sidebar items each permission opens. Items the role cannot open are not shown. */
const NAV: { key: SidebarItemKey; permission: Permission }[] = [
  { key: "overview", permission: "dashboard.view" },
  { key: "requests", permission: "bookings.view" },
  { key: "bookings", permission: "bookings.view" },
  { key: "calendar", permission: "bookings.view" },
  { key: "payments", permission: "payments.record" },
];

/**
 * Chrome for the business dashboard. The marketplace header and footer are
 * not rendered here (they live in the (site) layout), so nothing repeats.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant("dashboard.view");
  const db = getDb();
  const [memberships, writable, pulse, notifications, timezone] = await Promise.all([
    listMemberships(db, ctx.user.id),
    getWritable(ctx.business.id),
    getPulse(db, ctx),
    listNotifications(db, ctx.user.id, { businessId: ctx.business.id, limit: 30 }),
    primaryTimezone(ctx),
  ]);

  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-foreground px-4 py-2 text-sm text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" className="shrink-0 rounded-md text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4">
              Krello
            </Link>
            {memberships.length > 1 ? (
              <BusinessSwitcher current={ctx.business.id} options={memberships.map((m) => ({ id: m.business.id, name: m.business.name }))} />
            ) : (
              <span className="truncate text-sm font-semibold text-muted-foreground">{ctx.business.name}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <NotificationBell
              unread={pulse.unread}
              timezone={timezone}
              items={notifications.map((n) => ({
                id: n.id,
                title: n.title,
                body: n.body,
                link: n.link,
                createdAt: n.createdAt.toISOString(),
                read: n.readAt !== null,
              }))}
            />
            <UserMenu name={ctx.user.name} phone={maskPhone(ctx.user.phone)} isBusinessMember />
          </div>
        </div>
      </header>
      {!writable && <ReadOnlyBanner />}
      <div className="flex w-full flex-1 flex-col md:flex-row">
        <aside className="border-b px-4 py-2 md:sticky md:top-14 md:h-[calc(100dvh-3.5rem)] md:w-60 md:shrink-0 md:border-b-0 md:border-r md:px-3 md:py-6">
          <Sidebar items={NAV.filter((n) => ctx.can(n.permission)).map((n) => n.key)} pendingCount={pulse.pendingCount} />
        </aside>
        <main id="main" className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
      <PulseWatcher pendingCount={pulse.pendingCount} unread={pulse.unread} nextExpiryAt={pulse.nextExpiryAt?.toISOString() ?? null} />
    </>
  );
}
