# End-to-End Booking Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A demoable web app in which a customer finds a seeded venue, sees live availability, submits an OTP-verified booking request, and tracks it; and the venue's staff approve or reject it, enter phone and walk-in bookings, block resources, and record payments.

**Architecture:** One Next.js app (`apps/web`) holds the marketplace (`/`), the business dashboard (`/dashboard`) and, in a later plan, super-admin (`/admin`). Pages and server actions are thin: every rule lives in `packages/*` (already built: `database`, `pricing`, `booking-engine`, `core`) and is tested there against a real PostgreSQL. A worker script expires requests and delivers notifications.

**Tech Stack:** pnpm workspaces, TypeScript, Next.js (App Router, React Server Components, server actions), Tailwind CSS v4, shadcn/ui, Drizzle ORM, PostgreSQL (embedded for dev and tests), Vitest, Playwright, Zod.

**Spec:** `docs/V1_SPEC.md`. Open decisions are settled in `docs/decisions.md`; read both.

## What already exists (do not rewrite)

- `@krello/database`: `schema.ts` (all tables), `getDb()`, `createDb(url)`, `writeAudit`, `enqueueEvent`, `pgErrorCode`, types `Db`, `Tx`, `DbOrTx`, `Actor`. Migrations in `packages/database/drizzle`. Money is integer paise; schedule times are minutes from local midnight.
- `@krello/pricing`: `calculatePrice(req, rules)`, `findRuleConflicts(rules)`, `formatInr(paise)`.
- `@krello/booking-engine`: `getAvailability(db, {locationId, date, resourceIds?, audience?, now?})`, `createBooking(db, input)` → `{booking, statusToken, replayed}`, `transitionBooking(db, {bookingId, action, actor, businessId?, reason?, now?})`, `expireOverdueBookings(db, {now?, businessId?})`, `addInternalNote`, `createBlock`, `removeBlock`, `recordPayment`, `getTenantAccess(db, businessId)`, `resolvePolicy`, `describePolicy`, `EngineError` (`code`, `status`, `message` safe to show), `STATUS_LABEL`, time helpers `localToInstant`, `localDateOf`, `minuteOfDate`, `addDays`, `dayOfWeek`.
- `@krello/core`: `requestOtp`, `verifyOtp`, `createSession`, `getSessionUser`, `revokeSession`, `SESSION_COOKIE`, `SESSION_TTL_DAYS`, `normalisePhone`, `maskPhone`, `rateLimit`, `AppError`, `PERMISSIONS`, `can`, `getTenantContext(db, user, businessId)`, `listMemberships`, `listCategories`, `searchBusinesses`, `getPublicBusiness(db, slug)`, `listPublicReviews`, `RESERVED_SLUGS`, `slugify`, `getBookingByToken`, `getCustomerBooking`, `listCustomerBookings`, `listBusinessBookings`, `getBusinessBooking`, `processOutbox`, `listNotifications`, `countUnread`, `markNotificationsRead`, `cleanupExpiredOtps`.
- Tests: `pnpm test` (Vitest, boots its own PostgreSQL through `scripts/test-db.ts`). Test fixtures: `packages/booking-engine/test/fixtures.ts` (`testDb`, `makeVenue`, `customer`, `staff`).
- Dev database: `pnpm db:start` (port 54329), `pnpm db:migrate`. Env in `.env` (see `.env.example`).

## Global Constraints

- Only the booking engine writes to `bookings`, `booking_allocations`, `resource_blocks`, `payments`. Other code calls engine functions.
- Tenant access comes from `getTenantContext` (membership row). Never trust a business id from the browser without it. Check `ctx.can(permission)` and `ctx.canAccessLocation(id)` on the server for every dashboard action.
- Public pages and endpoints never return `internalNotes`, verification data, staff identities, or another customer's data. Customer phone numbers are shown only to signed-in business members.
- Booking status and payment status are separate. Never label booking value as money collected.
- A pending request is never described as confirmed. Status is never conveyed by colour alone: always a text label.
- Money: integer paise in code, shown with `formatInr`. Currency INR, language English, timezone shown from the location (seeded `Asia/Kolkata`).
- Booking status pages (`/booking/*`), `/account/*`, `/dashboard/*`, `/api/*` are `noindex` and excluded from `robots.txt` allow rules. Marketplace and business pages are server-rendered with title, description, canonical URL and Open Graph tags.
- Every form and page has loading, empty, error and success states, labelled inputs, and keyboard-reachable controls. Layouts work at 360 px width.
- Look: Apple-like, light. Tokens: background `#f5f5f7`, card `#ffffff`, ink `#1d1d1f`, secondary text `#6e6e73`, hairline `rgba(0,0,0,.08)`, green `#34c759`, orange `#ff9f0a`, blue `#0071e3`, red `#ff3b30`; card radius 18px; font stack `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", sans-serif`; tabular numerals for money and times. For marketplace pages also read `C:\Users\lykos\.agents\skills\design-taste-frontend\SKILL.md` and follow it where it applies.
- No Redis, no microservices, no in-memory timers for expiry.
- Create files with your file-writing tool, not shell heredocs (the shell here mishandles apostrophes in heredocs).
- Commit after each task with a message ending `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Use `git -C "D:/Booking Pagee"`; never run git from `D:\`.

## Review Focus

1. A customer double-clicks "Request booking" or retries on a flaky network: one booking results, and the same status page opens (idempotency key generated once per form mount). Test in Task 5.
2. Someone else takes the slot while the customer fills in their details: the form shows the conflict message, refreshes availability, and keeps the entered name and phone. Test in Task 5.
3. A staff member opens a booking or location they are not assigned to, or a member of business A requests business B's booking id: 404, nothing leaked. Test in Task 7.
4. The status page is opened after the hold deadline but before the worker has run: it shows "Expired", not "Awaiting venue response". Test in Task 5.
5. A phone number typed as `98765 43210`, `09876543210` or `+91-9876543210` signs in the same account; a 9-digit or landline number gets a clear message. Test in Task 3.

## Not in this plan

Super-admin and business verification screens, subscriptions and plan limits, reviews, favourites, browser push, analytics screens, editors for resources/schedules/pricing/staff/profile, and production hosting. Each gets its own plan after this one. The seed creates the data those editors would.

---

### Task 1: Demo seed

**Files:**
- Create: `scripts/seed.ts`, `scripts/seed-data.ts`
- Modify: `package.json` (script `db:seed` → `tsx --env-file=.env scripts/seed.ts`; `db:reset` → migrate then seed)
- Test: `packages/core/test/seed.test.ts`

**Interfaces:**
- Produces: `seedDemo(db: Db, opts?: { now?: Date }): Promise<SeedSummary>` exported from `scripts/seed.ts`, where `SeedSummary = { businesses: number; bookings: number; payments: number; reviews: number; logins: { role: string; phone: string; business?: string }[] }`. Running the file as a script calls it on `DATABASE_URL` and prints the logins.
- Fixed seed values later tasks rely on:
  - Categories (slug): `snooker-pool`, `gaming-lounge`, `swimming`, `football-turf`, `badminton`.
  - Businesses (slug, city Bengaluru): `cue-masters` (Indiranagar; Tables 1–5 at 60-minute slots and `VIP table` at 90-minute slots; exclusive, capacity 4; ₹200/h base, ₹300/h 17:00–23:00, ₹350/h Saturday and Sunday; open 11:00–23:00), `respawn-lounge` (Koramangala; `PC 01`–`PC 08` and `PlayStation 1`–`3`, 60-minute slots, exclusive, capacity 1 for PCs and 4 for PlayStations; ₹100/h PCs, ₹250/h PlayStations, ₹150/₹300 after 18:00; open 10:00–24:00), `bluelane-aquatics` (HSR Layout; `Lane 1`–`4` exclusive 45-minute slots at ₹350 per slot, plus shared `Open swim` capacity 20 and `Kids session` capacity 12, 60-minute slots priced per person at ₹200 and ₹300; open 06:00–10:00 and 16:00–21:00). `cue-masters` also has a second location in Koramangala with 3 tables.
  - Each business: verification `approved`, a subscription (`cue-masters` active, `respawn-lounge` trialing, `bluelane-aquatics` active), policy with `pendingHoldMinutes` 30/20/60.
  - Plans: Starter ₹999, Growth ₹2,499, Pro ₹4,999 (see `docs/decisions.md` OD-02).
  - Logins: super-admin `+919000000001`; owners `+919000000011` (cue-masters), `+919000000012` (respawn-lounge), `+919000000013` (bluelane-aquatics); manager `+919000000021` and staff `+919000000031` at cue-masters (staff assigned to the Indiranagar location only); customer `+919000000091`.
  - Bookings: about 45 days of history plus 7 days ahead per business, created through `createBooking` with `now` set in the past, then moved through `transitionBooking`; a mix of completed, no-show, rejected, expired, both cancellations, about 6 live `pending` requests expiring at staggered times, and approved future bookings. Roughly 70% online, 20% walk-in, 10% phone. Payments through `recordPayment`: most completed bookings paid (UPI 60%, cash 30%, card 10%), some partially paid, some unpaid. A seeded pseudo-random generator (fixed seed) so runs are repeatable.
  - Reviews on about a third of completed bookings (inserted directly; reviews are not engine-owned), with a few business responses.
  - All customer names and numbers fictional; customer phones in the `+9190000001xx`–`+9190000009xx` range.

- [ ] **Step 1: Write the failing test** `packages/core/test/seed.test.ts`:
  - `seedDemo(db, { now })` returns `businesses === 3`, `bookings > 300`, `payments > 150`, `reviews > 30`.
  - `searchBusinesses(db, {})` returns the three slugs; `searchBusinesses(db, { category: "swimming" })` returns only `bluelane-aquatics`; `searchBusinesses(db, { q: "playstation" })` returns only `respawn-lounge`.
  - `getAvailability` for `cue-masters` Indiranagar tomorrow lists 6 resources and at least one `available` slot priced `20000` and one priced `30000` (on a weekday) for `Table 1`.
  - No two active exclusive allocations overlap (query the table).
  - `sum(amount_collected) <= sum(total_amount)` and every booking with `payment_status = 'paid'` has `amount_collected = total_amount`.
  - Calling `seedDemo` a second time succeeds and yields the same business count (it truncates first).
- [ ] **Step 2: Run it** — `pnpm test packages/core/test/seed.test.ts` — expect failure: cannot find `scripts/seed`.
- [ ] **Step 3: Implement.** `seedDemo` starts with `TRUNCATE ... RESTART IDENTITY CASCADE` over every table and throws if `process.env.NODE_ENV === "production"`. Venue definitions live in `scripts/seed-data.ts` as plain data. History is generated day by day in time order; a slot that conflicts is skipped (catch `EngineError` with code `slot_conflict` or `validation`).
- [ ] **Step 4: Run the test** — expect pass. Then `pnpm db:seed` against the dev database and confirm it prints the logins.
- [ ] **Step 5: Commit** — `Add demo seed with three venues`.

### Task 2: Web app scaffold and design system

**Files:**
- Create: `apps/web/` (Next.js App Router app named `@krello/web`): `package.json`, `next.config.ts` (`transpilePackages` for the four `@krello/*` packages, `serverExternalPackages: ["postgres"]`), `tsconfig.json`, `postcss.config.mjs`, `components.json`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/robots.ts`, `src/lib/db.ts`, `src/lib/session.ts`, `src/lib/action.ts`, `src/lib/format.ts`, `src/components/ui/*` (shadcn: button, input, label, card, badge, dialog, select, textarea, tabs, skeleton, sonner), `src/components/status-badge.tsx`, `src/components/site-header.tsx`, `src/components/site-footer.tsx`
- Test: `apps/web/src/lib/format.test.ts`; add `apps/*/src/**/*.test.ts` to `vitest.config.ts` `include`

**Interfaces:**
- Produces (`src/lib/session.ts`, server-only):
  - `getCurrentUser(): Promise<UserRow | null>` — reads the `SESSION_COOKIE` cookie.
  - `requireUser(next: string): Promise<UserRow>` — redirects to `/login?next=<next>` when signed out.
  - `startSession(userId: string): Promise<void>` — sets an `httpOnly`, `sameSite: "lax"`, `secure` (in production) cookie for `SESSION_TTL_DAYS`.
  - `endSession(): Promise<void>`.
  - `requireTenant(permission?: Permission): Promise<TenantContext>` — resolves the active business from the `krello_business` cookie (falls back to the user's first membership), calls `getTenantContext`, redirects to `/login` when signed out, calls `notFound()` when there is no membership, and throws `AppError("forbidden", "You do not have permission to do that.", 403)` when `permission` is not granted.
- Produces (`src/lib/action.ts`): `type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }` and `runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>>`, which maps `EngineError` and `AppError` to `{ ok: false, code, message }`, maps Zod errors to code `validation` with the first issue's message, and for anything else logs it and returns code `internal` with message `Something went wrong. Please try again.` (it must rethrow Next.js redirect and not-found signals).
- Produces (`src/lib/format.ts`): `formatInr` (re-export), `formatTime(d: Date | string, tz: string): string` → `7:30 PM`, `formatDay(d, tz): string` → `Sat, 14 Nov`, `formatDayLong(date: string): string` → `Saturday, 14 November 2026` from `YYYY-MM-DD`, `formatRange(start, end, tz): string` → `Sat, 14 Nov · 7:30 PM – 9:00 PM`, `minuteLabel(minute: number): string` → `7:30 PM` (values ≥ 1440 wrap), `countdown(to: Date, now: Date): string` → `12 min left`, `1 h 05 min left`, or `Expired`.
- Produces (`src/components/status-badge.tsx`): `<StatusBadge status={BookingStatus} />` and `<PaymentBadge status />`, each rendering an icon plus the text label from `STATUS_LABEL` (payment labels: `Unpaid`, `Partly paid`, `Paid`).

- [ ] **Step 1: Write the failing test** `format.test.ts` with these assertions (timezone `Asia/Kolkata`): `formatTime("2026-11-14T14:00:00Z", tz) === "7:30 PM"`; `formatDay("2026-11-14T14:00:00Z", tz) === "Sat, 14 Nov"`; `formatDayLong("2026-11-14") === "Saturday, 14 November 2026"`; `formatRange("2026-11-14T14:00:00Z", "2026-11-14T15:30:00Z", tz) === "Sat, 14 Nov · 7:30 PM – 9:00 PM"`; `minuteLabel(1170) === "7:30 PM"`; `minuteLabel(1500) === "1:00 AM"`; `countdown` returns `"12 min left"` for 12 minutes 20 seconds ahead, `"1 h 05 min left"` for 65 minutes ahead, `"Expired"` for the past.
- [ ] **Step 2: Run it** — expect failure (module missing).
- [ ] **Step 3: Scaffold the app** (latest stable Next.js, React, Tailwind v4, `shadcn` CLI for the listed components) and implement the files above. `globals.css` defines the Global Constraints tokens as CSS variables mapped onto the shadcn theme. The root layout sets `metadataBase` from `NEXT_PUBLIC_SITE_URL` (default `http://localhost:3000`) and loads `.env` from the repo root (`next.config.ts` uses `loadEnvConfig` on the monorepo root). `robots.ts` allows `/` and disallows `/dashboard`, `/admin`, `/account`, `/booking`, `/api`, `/login`.
- [ ] **Step 4: Verify** — `pnpm test` passes; `pnpm --filter @krello/web build` succeeds; `pnpm dev` serves a placeholder home page at `http://localhost:3000` using the header and footer.
- [ ] **Step 5: Commit** — `Scaffold web app with design tokens and session helpers`.

### Task 3: Sign-in with phone and OTP

**Files:**
- Create: `apps/web/src/app/login/page.tsx`, `apps/web/src/app/login/login-form.tsx`, `apps/web/src/app/login/actions.ts`, `apps/web/src/components/otp-input.tsx`, `apps/web/src/components/user-menu.tsx`, `apps/web/src/app/api/auth/me/route.ts`
- Modify: `apps/web/src/components/site-header.tsx` (user menu or "Sign in")
- Test: `packages/core/test/auth.test.ts`

**Interfaces:**
- Produces (`login/actions.ts`, `"use server"`):
  - `requestOtpAction(input: { phone: string }): Promise<ActionResult<{ phone: string; retryAfterSeconds: number; demoCode?: string }>>` — `phone` in the result is the normalised number; client IP from `x-forwarded-for`.
  - `verifyOtpAction(input: { phone: string; code: string; name?: string }): Promise<ActionResult<{ userId: string; name: string | null }>>` — on success calls `startSession`.
  - `logoutAction(): Promise<void>` — `revokeSession`, `endSession`, redirect `/`.
- Produces: `<OtpInput length={6} onComplete={(code) => …} />`, used again in Task 5.
- After sign-in the page redirects to `next` only if it is a same-site path beginning with a single `/`; otherwise to `/dashboard` when the user has a membership, else `/account`.
- When `demoCode` is present the form shows `Demo mode: your code is 123456` in a notice. This is how demos run without an SMS provider.

- [ ] **Step 1: Write the failing tests** `packages/core/test/auth.test.ts` (use `testDb()`; set `process.env.SESSION_SECRET` in the test):
  - `normalisePhone` maps `"98765 43210"`, `"09876543210"`, `"+91-9876543210"`, `"919876543210"` to `"+919876543210"`, and returns `null` for `"987654321"`, `"08012345678"`, `"abc"`.
  - `requestOtp` with a capturing sender then `verifyOtp` with that code returns a user with `phoneVerifiedAt` set; a second `verifyOtp` with the same code throws `AppError` code `otp_expired`.
  - Five wrong codes then the right one throws code `otp_locked`.
  - A second `requestOtp` within 30 seconds throws code `otp_cooldown`; a sixth request inside 15 minutes (advance `now` by 31 seconds each time) throws code `rate_limited`.
  - A code is rejected with `otp_expired` when verified with `now` 6 minutes later.
  - `requestOtp` returns the same shape for a new number and an existing user's number.
  - `createSession` then `getSessionUser` returns the user; after `revokeSession` it returns `null`; a suspended user's session returns `null`.
  - `can("staff", "bookings.decide") === false`, `can("manager", "bookings.decide") === true`, `can("manager", "staff.manage") === false`, `can("owner", "subscription.manage") === true`.
- [ ] **Step 2: Run** — these exercise existing code; fix any defect they expose in `packages/core/src/auth.ts`.
- [ ] **Step 3: Implement** the login page: step one phone (with `+91` prefix shown), step two code with resend countdown and "Change number". Errors render inline under the field, announced with `role="alert"`.
- [ ] **Step 4: Verify** — `pnpm test` passes; in the browser, sign in as `+919000000091` using the on-screen demo code, see the user menu, sign out.
- [ ] **Step 5: Commit** — `Add phone OTP sign-in`.

### Task 4: Marketplace and business pages

**Files:**
- Create: `apps/web/src/app/(site)/layout.tsx`, `apps/web/src/app/(site)/page.tsx`, `apps/web/src/app/(site)/search/page.tsx`, `apps/web/src/app/(site)/c/[category]/page.tsx`, `apps/web/src/app/(site)/[businessSlug]/page.tsx`, `apps/web/src/app/(site)/[businessSlug]/[locationSlug]/page.tsx`, `apps/web/src/app/sitemap.ts`, `apps/web/src/components/marketplace/business-card.tsx`, `search-bar.tsx`, `filters.tsx`, `category-tiles.tsx`, `business-hero.tsx`, `hours-table.tsx`, `review-list.tsx`, `apps/web/src/app/api/public/categories/route.ts`, `apps/web/src/app/api/public/businesses/route.ts`, `apps/web/src/app/api/public/businesses/[slug]/route.ts`
- Test: `packages/core/test/catalog.test.ts`

**Interfaces:**
- Consumes: `searchBusinesses`, `listCategories`, `getPublicBusiness`, `listPublicReviews`.
- Produces: the business page renders a client component slot `<BookingPanel business={PublicBusiness} initialLocationId={string} />` imported from `@/components/booking/booking-panel` (Task 5 builds it; until then export a placeholder card from that path that says `Booking opens here`).
- URL rules: home `/`; search `/search?q=&category=&city=&sort=&minRating=&maxPrice=&page=`; category `/c/<slug>`; business `/<businessSlug>`; location `/<businessSlug>/<locationSlug>` (same page with that location preselected; canonical points to itself). An unknown or unlisted slug calls `notFound()`.
- Search page filters: category, city or locality text, price ceiling, minimum rating; sort: relevance, price low to high, price high to low, rating. Changing a filter updates the URL (shareable, back button works). Empty result shows `No venues match. Try a different area or activity.` with a clear-filters link.
- Home: search bar, category tiles, "Popular near you" grid (top 6 by rating), a short "How it works" strip (See what is free → Request your slot → Venue confirms → Pay at the venue), and a "List your venue" link to `/login?next=/dashboard`.
- Business page sections in order: hero (cover, name, categories, rating and review count, locality), booking panel, about, amenities, hours per location (today highlighted), what you can book (resources with "from ₹… per hour/slot"), booking and cancellation policy (`policyLines`), reviews (first 10, "Show more" loads the next page), contact and address.
- SEO: `generateMetadata` gives title `<Business> — book <first category> in <locality>, <city> | Krello`, description from the business description (max 155 chars), canonical URL, Open Graph image from `coverUrl`; a JSON-LD `LocalBusiness` block with name, address, telephone, `aggregateRating` when reviews exist. `sitemap.ts` lists home, each category page and each listed business.
- Public API routes return JSON of the same core functions, with `{ error: { code, message } }` and the right status on failure, and `Cache-Control: public, max-age=60`.

- [ ] **Step 1: Write the failing tests** `catalog.test.ts` (build venues with a local helper on top of `makeVenue`, adding categories and reviews):
  - A business that is `pending_review`, or `suspended`, or has `isListed = false`, or whose subscription is `expired`, or that has no active resource, is absent from `searchBusinesses` and `getPublicBusiness` returns `null` for it.
  - `q` matches business name, locality, category name and resource name, case-insensitively; `%` and `_` in `q` are treated literally.
  - `sort: "price_asc"` orders by lowest base price; `minRating: 4` excludes a venue averaging 3.5; removed reviews do not count toward rating.
  - `getPublicBusiness` output has no key named `policy` raw JSON leak beyond the resolved policy, no `ownerUserId`, no `internalNotes`; `JSON.stringify` of it contains none of the customers' phone numbers.
  - `slugify("Cue Masters — Snooker & Pool!") === "cue-masters-snooker-pool"`; `RESERVED_SLUGS.has("dashboard")`.
- [ ] **Step 2: Run** — fix any defect exposed in `packages/core/src/catalog.ts`.
- [ ] **Step 3: Implement the pages and components.**
- [ ] **Step 4: Verify** — `pnpm test`; `pnpm --filter @krello/web build`; with the seed loaded, the home page shows three venues, `/search?q=playstation` shows one, `/cue-masters` renders every section, `/nope` is a 404, page source of `/cue-masters` contains the JSON-LD block and a canonical link.
- [ ] **Step 5: Commit** — `Add marketplace, search and business pages`.

### Task 5: Booking request flow and status page

**Files:**
- Create: `apps/web/src/components/booking/booking-panel.tsx`, `date-strip.tsx`, `slot-grid.tsx`, `booking-summary.tsx`, `details-step.tsx`, `apps/web/src/app/(site)/[businessSlug]/actions.ts`, `apps/web/src/app/api/public/availability/route.ts`, `apps/web/src/app/booking/[token]/page.tsx`, `apps/web/src/app/booking/[token]/status-view.tsx`, `apps/web/src/app/booking/[token]/actions.ts`, `apps/web/src/app/api/booking-status/[token]/route.ts`, `packages/core/src/requests.ts`
- Modify: `packages/core/src/index.ts` (export `./requests`), `packages/core/src/bookings.ts`
- Test: `packages/core/test/requests.test.ts`

**Interfaces:**
- Produces (`packages/core/src/requests.ts`):
  - `quoteBooking(db, input: { locationId: string; resourceIds: string[]; startsAt: Date; endsAt: Date; groupSize: number }): Promise<{ total: number; lines: { resourceId: string; name: string; amount: number; segments: PriceSegment[] }[] }>` — prices without booking, same rules as the engine, throws `EngineError` when a slot is not bookable.
  - `submitBookingRequest(db, input: { user: UserRow; locationId: string; resourceIds: string[]; startsAt: Date; endsAt: Date; groupSize: number; name: string; email?: string; notes?: string; idempotencyKey: string; ip?: string }): Promise<{ statusToken: string; reference: string }>` — requires `user.phoneVerifiedAt`; rate-limits to 10 submissions per phone per hour (`AppError` code `rate_limited`, status 429); calls `createBooking` with `source: "online"`, the user's phone and id, and saves `name` on the user when the user has none.
  - `effectiveStatus(b: { status: BookingStatus; pendingExpiresAt: Date | null }, now: Date): BookingStatus` — returns `"expired"` for a `pending` booking whose deadline has passed. `getBookingByToken`, `getCustomerBooking` and `listCustomerBookings` use it for the `status` they return.
  - `cancelByToken(db, token: string, reason?: string): Promise<CustomerBookingView>` and `cancelOwnBooking(db, userId: string, bookingId: string, reason?: string): Promise<CustomerBookingView>` — `transitionBooking` with `cancel_by_customer`.
- Produces (server actions, `[businessSlug]/actions.ts`): `quoteAction(input)`, `submitRequestAction(input)` → `ActionResult<{ statusUrl: string }>` where `statusUrl` is `/booking/<token>`; signed-out callers get code `auth_required`.
- `GET /api/public/availability?locationId=&date=YYYY-MM-DD` returns `getAvailability` output for audience `customer`, `Cache-Control: no-store`, rate-limited to 120 requests per minute per IP (429 with the standard error shape).
- `GET /api/booking-status/<token>` returns `{ status, pendingExpiresAt, canCancel }` with `Cache-Control: no-store` and header `X-Robots-Tag: noindex`.
- Booking panel behaviour:
  - Location picker when the business has more than one; a horizontal date strip from today to the furthest `advanceDays`; a grid of resources (rows) by slot start times (columns), scrolling horizontally on small screens.
  - Each slot is a button showing its time and price. States use text and shape, not only colour: available (price shown), held (`On hold`, disabled), booked (`Booked`, disabled), blocked or unavailable (`—`, disabled). Shared resources show `7 left`.
  - Selecting slots: any number of resources, all for the same time window; consecutive slots on a resource extend the window; choosing a slot at a different time on another resource replaces the selection after a confirm. A group-size stepper.
  - Summary shows each line and the total from `quoteAction`, the date and time with the timezone name (`India Standard Time`), the sentence `This is a request. Your booking is confirmed only when the venue approves it.`, the hold duration, and the `policyLines`.
  - Details step: name, phone (prefilled and read-only when signed in), optional email and notes. Signed-out customers verify by OTP inline (`requestOtpAction`, `verifyOtpAction`, `<OtpInput>` from Task 3), then the request is submitted automatically.
  - The idempotency key is a UUID created once when the panel mounts and reused for every retry of that selection; it is regenerated only after a successful submission or a changed selection.
  - On code `slot_conflict`: show the message, re-fetch availability, clear only the conflicting selection, keep name, email and notes.
  - Availability re-fetches when the tab regains focus and every 30 seconds while visible.
- Status page (`/booking/<token>`): big text status with icon; for pending, a live countdown to `pendingExpiresAt` and `The venue has until 7:30 PM to respond`; reference, venue, address, date and time, items, group size, total and `Pay at the venue`; decline or cancellation reason when present; cancel button when `canCancel` (confirm dialog, reason field, required when policy says so); venue phone link. It polls `/api/booking-status/<token>` every 15 seconds while pending and refreshes on change. An unknown, revoked or expired token renders a `This link is no longer valid` page with status 404. Terminal states say when the slot was released: `The slot is open for others again.`

- [ ] **Step 1: Write the failing tests** `requests.test.ts`:
  - `quoteBooking` total equals the `totalAmount` of the booking `submitBookingRequest` then creates for the same input.
  - Two concurrent `submitBookingRequest` calls with the same idempotency key yield the same `reference` and exactly one booking row.
  - Two different users requesting the same slot: one resolves, the other rejects with `EngineError` code `slot_conflict`.
  - A user without `phoneVerifiedAt` is rejected with `AppError` code `phone_unverified`.
  - `effectiveStatus({ status: "pending", pendingExpiresAt: past }, now) === "expired"`; `getBookingByToken` returns `status: "expired"` and `canCancel: false` for an overdue pending booking before any worker has run.
  - `getBookingByToken` returns `null` for a wrong token, a revoked token, and a token for a booking that ended more than 30 days ago.
  - `JSON.stringify` of the token view contains neither the internal notes text nor the customer's phone number.
  - `cancelByToken` on a pending booking returns status `cancelled_by_customer` and the slot shows `available` again; on an approved booking past the deadline it rejects with code `policy`.
- [ ] **Step 2: Run** — expect failures (module missing).
- [ ] **Step 3: Implement `requests.ts`, the actions, routes, panel and status page.**
- [ ] **Step 4: Verify** — `pnpm test`; `pnpm --filter @krello/web build`; in the browser, signed out, book Table 1 at `cue-masters` for tomorrow with a new phone number, land on the status page showing `Awaiting venue response` with a countdown; cancel it; the slot is bookable again.
- [ ] **Step 5: Commit** — `Add booking request flow and status page`.

### Task 6: Customer account

**Files:**
- Create: `apps/web/src/app/account/layout.tsx`, `apps/web/src/app/account/page.tsx` (bookings: Upcoming and Past tabs), `apps/web/src/app/account/bookings/[id]/page.tsx`, `apps/web/src/app/account/profile/page.tsx`, `apps/web/src/app/account/actions.ts`, `packages/core/src/customers.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/customers.test.ts`

**Interfaces:**
- Produces (`customers.ts`): `updateProfile(db, userId: string, input: { name: string; email?: string | null }): Promise<UserRow>` — name 1–80 characters trimmed, email validated when present, `AppError` code `validation` otherwise.
- The booking detail page reuses `status-view.tsx` from Task 5, fed by `getCustomerBooking`, with cancel through `cancelOwnBooking`.
- `/account/*` requires sign-in (`requireUser`), sets `robots: noindex`.

- [ ] **Step 1: Write the failing tests:** `listCustomerBookings` returns only that user's bookings, newest start first, across two businesses; `getCustomerBooking(db, otherUserId, bookingId)` returns `null`; `cancelOwnBooking` with another user's id rejects with `EngineError` code `not_found`; `updateProfile` rejects an empty name and `"not-an-email"`, and accepts and trims `"  Asha Rao "`.
- [ ] **Step 2: Run** — expect failures.
- [ ] **Step 3: Implement.** Empty states: `No upcoming bookings. Find something to do` linking to `/`.
- [ ] **Step 4: Verify** — `pnpm test`, build, and in the browser sign in as `+919000000091` and see seeded history.
- [ ] **Step 5: Commit** — `Add customer account pages`.

### Task 7: Dashboard shell, requests and booking detail

**Files:**
- Create: `apps/web/src/app/dashboard/layout.tsx`, `apps/web/src/app/dashboard/page.tsx` (overview), `apps/web/src/app/dashboard/requests/page.tsx`, `apps/web/src/app/dashboard/bookings/page.tsx` (list with filters), `apps/web/src/app/dashboard/bookings/[id]/page.tsx`, `apps/web/src/app/dashboard/bookings/[id]/booking-actions.tsx`, `apps/web/src/app/dashboard/actions.ts`, `apps/web/src/app/api/dashboard/pulse/route.ts`, `apps/web/src/components/dashboard/sidebar.tsx`, `business-switcher.tsx`, `location-filter.tsx`, `notification-bell.tsx`, `expiry-countdown.tsx`, `read-only-banner.tsx`, `packages/core/src/dashboard.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/dashboard.test.ts`

**Interfaces:**
- Produces (`dashboard.ts`), every function taking `ctx: TenantContext` so that scoping cannot be skipped:
  - `getOverview(db, ctx, opts: { locationId?: string; now?: Date }): Promise<Overview>` with `Overview = { pendingCount; todayRequests; todayConfirmed; todayBookingValue; todayCollected; todayCancelled; upcoming: BusinessBookingListItem[]; pending: BusinessBookingListItem[]; resourcesNow: { resourceId; name; locationName; state: "free" | "occupied" | "blocked" }[] }`. "Today" is the venue-local day. `todayBookingValue` sums `totalAmount` of today's bookings in `approved`, `completed` or `no_show`; `todayCollected` sums payment collections minus refunds recorded today. Staff-assigned locations restrict every figure.
  - `listBookingsForTenant(db, ctx, filters: BusinessBookingFilters)` — `listBusinessBookings` with `locationIds: ctx.locationIds`.
  - `getBookingForTenant(db, ctx, bookingId)` — `getBusinessBooking`, returning `null` when the booking's location is not one the member may access.
  - `decideBooking(db, ctx, input: { bookingId: string; action: "approve" | "reject" | "cancel_by_business" | "complete" | "no_show"; reason?: string })` — permission map: approve/reject → `bookings.decide`, cancel → `bookings.cancel`, complete/no_show → `bookings.mark_attendance`; throws `AppError` code `forbidden` (403) without it; checks location access (404 as `EngineError` `not_found`); then `transitionBooking` with `actor: { kind: "business", userId }` and `businessId: ctx.business.id`.
  - `addNoteForTenant(db, ctx, bookingId, note)` — needs `bookings.add_note`.
- Produces (`dashboard/actions.ts`): `decideBookingAction`, `addNoteAction`, `switchBusinessAction(businessId)` (sets the `krello_business` cookie only after `getTenantContext` succeeds), `markNotificationsReadAction`.
- `GET /api/dashboard/pulse` → `{ pendingCount, unread, nextExpiryAt }`, `no-store`; the layout polls it every 20 seconds and refreshes the requests list when `pendingCount` changes.
- Layout: sidebar with Overview, Requests (pending count badge), Bookings, Calendar, Payments (items the role cannot open are hidden using `ctx.can`); business switcher when the user has several memberships; notification bell with unread count and the last 30 notifications; a banner `Read-only: your subscription has expired. Renew to manage bookings.` when `getTenantAccess(...).writable` is false, with action buttons disabled.
- Requests page: pending requests ordered by soonest expiry; each card shows customer name, phone as a `tel:` link, items, date and time, group size, total, customer notes, and `<ExpiryCountdown>` (text turns to `Under 5 min` styling plus the words, not colour alone). Approve is one click; Decline opens a dialog requiring a reason. A conflict or late decision shows the engine's message and refreshes.
- Booking detail: everything on the card plus status history timeline (who, when, reason), internal notes with an add-note box, payment summary and ledger (Task 9 adds the entry form), and the actions valid for the current status and role. `Mark completed` and `No-show` appear only after the start time.
- Bookings list filters: status, source, payment status, location, date range, text search (name, phone, reference); paginated 25 per page.

- [ ] **Step 1: Write the failing tests** `dashboard.test.ts` (two venues A and B; in A an owner, a manager, and a staff member assigned to location 1 of 2):
  - `getBookingForTenant` with B's context and A's booking id → `null`; `decideBooking` likewise rejects with code `not_found`.
  - Staff: `decideBooking` approve → `AppError` `forbidden`; `no_show` after the start time succeeds; `listBookingsForTenant` omits location 2's bookings; `getBookingForTenant` for a location 2 booking → `null`; `getOverview` counts exclude location 2.
  - Manager approves a pending booking; the status history row records the manager's user id.
  - `getOverview`: with one approved ₹300 booking today, one pending today, one cancelled today and a ₹100 cash collection today, `todayBookingValue === 30000`, `todayCollected === 10000`, `pendingCount === 1`, `todayCancelled === 1`; a pending booking is not in `todayBookingValue`.
  - With an expired subscription, `decideBooking` approve rejects with `EngineError` code `read_only`.
- [ ] **Step 2: Run** — expect failures.
- [ ] **Step 3: Implement `dashboard.ts`, actions, layout and pages.**
- [ ] **Step 4: Verify** — `pnpm test`, build; in the browser sign in as `+919000000011`, approve one seeded request and decline another with a reason; sign in as staff `+919000000031` and confirm Approve is absent and Koramangala bookings are not listed.
- [ ] **Step 5: Commit** — `Add business dashboard: overview, requests, booking detail`.

### Task 8: Calendar, manual bookings and blocks

**Files:**
- Create: `apps/web/src/app/dashboard/calendar/page.tsx`, `calendar-grid.tsx`, `manual-booking-dialog.tsx`, `block-dialog.tsx`, `apps/web/src/app/dashboard/calendar/actions.ts`, `apps/web/src/app/api/dashboard/availability/route.ts`, `packages/core/src/calendar.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/calendar.test.ts`

**Interfaces:**
- Produces (`calendar.ts`):
  - `getCalendarDay(db, ctx, input: { locationId: string; date: string }): Promise<{ timezone: string; resources: { id; name; bookingMode; capacity; slots: SlotView[] }[]; bookings: { id; reference; customerName; status; source; paymentStatus; startsAt; endsAt; resourceIds: string[]; groupSize }[]; blocks: { id; resourceId; startsAt; endsAt; reason }[] }>` — availability with audience `business`; bookings in every non-released state plus completed and no-show; requires location access.
  - `getCalendarWeek(db, ctx, input: { locationId: string; from: string }): Promise<{ date: string; confirmed: number; pending: number; bookedMinutes: number; availableMinutes: number }[]>` for 7 days.
  - `createManualBooking(db, ctx, input: { locationId; resourceIds; startsAt; endsAt; source: "phone" | "walk_in" | "admin"; name: string; phone?: string; groupSize: number; notes?: string; idempotencyKey: string })` — needs `bookings.create_manual`; a provided phone must normalise (`AppError` `invalid_phone`); a blank name for a walk-in becomes `Walk-in`.
  - `blockResource(db, ctx, input: { resourceId; startsAt; endsAt; reason?: string })` and `unblockResource(db, ctx, blockId)` — need `blocks.manage`.
- Calendar page: location selector, date navigation (previous, today, next, date picker), Day and Week views, filters for resource, status and source. Day view is a grid of resources by time; bookings are blocks labelled with customer name and a status word, pending ones marked `Pending` with a dashed outline, blocks hatched and labelled with their reason. Clicking a booking opens a quick view (customer, phone, items, total, payment status, link to detail). Clicking a free slot opens the manual booking dialog prefilled with that resource and time; a separate `Block time` button opens the block dialog. Week view shows per-day counts and a utilisation bar, each day linking to its Day view.
- A manual booking that conflicts shows the engine message and refreshes the grid.

- [ ] **Step 1: Write the failing tests:** a walk-in created through `createManualBooking` is `approved`, has `source: "walk_in"`, `createdBy` equal to the staff user, and the same slot then reads `confirmed` in `getAvailability` for audience `customer`; it rejects with `slot_conflict` over a pending online hold; staff can create a manual booking but `blockResource` rejects with `forbidden`; a manager blocks 10:00–12:00 and `getCalendarDay` returns the block and those slots as `blocked`; `unblockResource` frees them; `getCalendarDay` for a location the staff member is not assigned to rejects with `not_found`; `getCalendarWeek` returns 7 entries and `bookedMinutes` of 60 for a day with one confirmed one-hour booking.
- [ ] **Step 2: Run** — expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** — `pnpm test`, build; in the browser add a walk-in from the calendar and confirm the public page shows that slot as `Booked`.
- [ ] **Step 5: Commit** — `Add calendar, manual bookings and resource blocks`.

### Task 9: Venue payments

**Files:**
- Create: `apps/web/src/app/dashboard/payments/page.tsx`, `apps/web/src/app/dashboard/bookings/[id]/payment-form.tsx`, `apps/web/src/app/dashboard/payments/actions.ts`, `packages/core/src/collections.ts`
- Modify: `apps/web/src/app/dashboard/bookings/[id]/page.tsx`, `packages/core/src/index.ts`
- Test: `packages/core/test/collections.test.ts`

**Interfaces:**
- Produces (`collections.ts`):
  - `recordCollection(db, ctx, input: { bookingId: string; kind: "collection" | "refund"; amountRupees: string; method: "cash" | "upi" | "card" | "other"; reference?: string; notes?: string; idempotencyKey: string })` — `collection` needs `payments.record`, `refund` needs `payments.refund`; parses rupees with up to 2 decimals into paise (`"150"` → 15000, `"150.5"` → 15050; rejects `"0"`, `"-5"`, `"1.234"`, `"abc"` with `AppError` `validation`); location access enforced.
  - `listCollections(db, ctx, filters: { from?: Date; to?: Date; method?; locationId?; page? })` → paginated ledger rows with booking reference, customer name, kind, amount, method, recorded-by name, time.
  - `getCollectionSummary(db, ctx, range: { from: Date; to: Date; locationId?: string })` → `{ bookingValue, collected, outstanding, byMethod: Record<method, number>, paidCount, partlyPaidCount, unpaidCount, cancelledValue }`. `bookingValue` covers bookings starting in the range with status `approved`, `completed` or `no_show`; `collected` is collections minus refunds recorded in the range; `outstanding` is `totalAmount - amountCollected` over those same bookings; `cancelledValue` is reported separately and is in none of the other figures.
- Payments page: range selector (Today, 7 days, 30 days, custom), summary tiles labelled exactly `Booking value`, `Collected`, `Outstanding` (never "revenue"), a by-method breakdown, an `Outstanding bookings` list linking to each booking, and the ledger table.
- Booking detail gains the entry form: amount prefilled with the amount still due, method, optional reference and note; refund is a separate secondary action shown only with `payments.refund`.

- [ ] **Step 1: Write the failing tests:** amount parsing cases above; staff records a collection but a staff refund rejects with `forbidden`; an over-collection rejects with `EngineError` `payment_exceeds_due`; a repeated call with the same idempotency key creates one payment row; summary for a range with a ₹300 approved booking paid ₹100 by UPI, a ₹400 completed booking paid in full by cash, and a ₹500 cancelled booking gives `bookingValue 70000`, `collected 50000`, `outstanding 20000`, `byMethod.upi 10000`, `byMethod.cash 40000`, `cancelledValue 50000`, `paidCount 1`, `partlyPaidCount 1`, `unpaidCount 0`; a ₹50 refund lowers `collected` to 45000; B's context sees none of A's rows.
- [ ] **Step 2: Run** — expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** — `pnpm test`, build; record a part payment in the browser and see the booking read `Partly paid` while still `Confirmed`.
- [ ] **Step 5: Commit** — `Add venue payment recording and collections report`.

### Task 10: Worker, end-to-end test and run instructions

**Files:**
- Create: `scripts/worker.ts`, `e2e/booking.spec.ts`, `playwright.config.ts`, `README.md`
- Modify: `package.json` (scripts `worker`, `dev:all`, `e2e`), `.gitignore` (Playwright output)
- Test: `packages/core/test/worker.test.ts`, `e2e/booking.spec.ts`

**Interfaces:**
- Produces (`scripts/worker.ts`): `runWorkerOnce(db: Db, now?: Date): Promise<{ expired: number; notified: number; failed: number }>` — `expireOverdueBookings`, then `processOutbox`, then `cleanupExpiredOtps`. Run as a script it loads `.env`, calls `runWorkerOnce` every 15 seconds (`WORKER_INTERVAL_MS`), logs one line per cycle that did something, never overlaps two cycles, and exits cleanly on SIGINT. `--once` runs a single cycle (for a cloud scheduler).
- `pnpm dev:all` starts the dev database, runs migrations, then the web app and the worker together.
- `README.md`: what the product is in three sentences, prerequisites (Node 22+, pnpm), first run (`pnpm install`, `pnpm db:start`, `pnpm db:reset`, `pnpm dev:all`), the demo logins from the seed, how OTP works in demo mode, how to run tests, the folder map, and a "Not built yet" list copied from this plan's "Not in this plan".

- [ ] **Step 1: Write the failing test** `worker.test.ts`: create a pending request, call `runWorkerOnce` with `now` past its deadline → `expired: 1`, the booking is `expired`, the owner has an in-app notification titled `Request expired`, and a second call returns `expired: 0, notified: 0`. Approving a request then running the worker gives the signed-in customer a notification titled `Booking confirmed`.
- [ ] **Step 2: Run** — expect failure.
- [ ] **Step 3: Implement the worker and scripts.**
- [ ] **Step 4: Write the Playwright test** `e2e/booking.spec.ts` (config starts the app on a free port against a freshly seeded throwaway database, `workers: 1`):
  1. Open `/`, search `snooker`, open `cue-masters`.
  2. Pick tomorrow, select the first available `Table 2` slot, continue, enter a name and a fresh phone number, read the demo code from the notice, submit.
  3. Expect the status page to show `Awaiting venue response`.
  4. In a second browser context, the same slot on `/cue-masters` reads `On hold`.
  5. Sign in as owner `+919000000011`, open Requests, approve that request.
  6. Reload the status page: `Confirmed`. The public slot reads `Booked`.
  7. As owner, record a ₹100 cash payment: the booking shows `Partly paid` and still `Confirmed`.
- [ ] **Step 5: Verify** — `pnpm test` and `pnpm e2e` pass; `pnpm --filter @krello/web build` succeeds; follow the README from a clean clone path mentally and fix any missing step.
- [ ] **Step 6: Commit** — `Add worker, end-to-end test and README`.
