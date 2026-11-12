# Decisions log

The V1 spec (`docs/V1_SPEC.md`) leaves a number of decisions open and asks that
they not be assumed silently. This file records what the build currently does
for each one. Everything here was chosen by the builder following the spec's
recommended default unless marked **Owner decided**. Any of them can be changed;
the note under each says how costly a change would be.

## Product decisions (spec section 29)

| ID | Decision | Current choice | Cost to change |
|----|----------|----------------|----------------|
| OD-01 | Product name | "Krello" (spec working name) | Low: config string |
| OD-02 | Plan prices | Placeholder seed plans: Starter ₹999, Growth ₹2,499, Pro ₹4,999 per month | Low: admin-editable data |
| OD-03 | Grace period | 7 days, platform setting | Low |
| OD-04 | Approved future bookings after subscription expiry | Kept, never auto-cancelled; dashboard read-only | Medium |
| OD-05 | Staff permissions | Central matrix in `packages/auth`. Staff can view bookings, create phone/walk-in bookings, mark completed/no-show, record payments. Staff cannot approve/reject, cancel, or edit payments | Low: one file |
| OD-06 | Multi-resource intervals | All resources in one booking share the same date and time window | Medium |
| OD-07 | Manual extension of pending expiry | Not built | Low to add |
| OD-08 | Slot crossing a price boundary | Split by time segment and sum | Medium |
| OD-09 | Reviews | 1–5 stars, tied to location, no edits after posting | Low |
| OD-10 | OTP provider | Adapter interface; development adapter prints the code to the server console and shows it on screen, and only when `OTP_DEMO_MODE=1` is set; with the flag off and no real sender, requesting a code is refused. No SMS provider chosen | Low: add an adapter |
| OD-11 | Browser push | Standard Web Push (VAPID) via the `web-push` library | Low |
| OD-12 | Backend framework | Domain logic in shared packages, served by Next.js route handlers and server actions | Medium |
| OD-13 | ORM | Drizzle, with hand-written SQL for integrity constraints | High |
| OD-14 | Cloud | Not chosen. Local development only so far | n/a |
| OD-15 | Guest status link | 32-byte random token, stored hashed, revocable, expires 30 days after the booking ends | Low |
| OD-16 | Customer booking limits | Max 3 pending requests per phone number across the platform | Low |
| OD-17 | Booking-volume quota | Counts approved bookings from all sources per calendar month | Low |
| OD-18 | Subscription payment proof | Transaction reference required, proof image optional | Low |
| OD-19 | Identity verification | Owner uploads one ID image plus venue photos; reviewed by hand | Medium |
| OD-20 | Reminders | Not in V1 | Low to add |

## Engineering decisions

- **One deployable app to start.** The spec proposes four apps (marketplace,
  business, admin, api). The build starts with a single Next.js app,
  `apps/web`, holding all three surfaces: the marketplace at `/`, the business
  dashboard at `/dashboard`, and super-admin at `/admin`. All domain logic lives
  in `packages/*`, so splitting into separate apps later is a move of route
  files, not a rewrite. Business slugs that collide with reserved paths are
  rejected.
- **Double-booking guard.** The spec allows slot interval to differ from slot
  duration, so slots on one resource can overlap. Active allocations are
  therefore protected by a PostgreSQL range exclusion constraint
  (`tstzrange` + `btree_gist`), not a unique key on slot start.
- **Times.** Stored as UTC `timestamptz`; each location carries a timezone
  (seeded as `Asia/Kolkata`). Money is stored as integer paise.
- **Background work.** A worker script run on a schedule expires overdue
  requests, moves subscriptions through trial and grace, and sends queued
  notifications from an outbox table. No in-memory timers.
- **Database in development.** Real PostgreSQL, either from Docker
  (`docker compose up`) or an embedded copy started by the dev script.
- **Demo data.** The seed creates three fictional venues in Bengaluru: a
  snooker hall, a gaming lounge and a swimming pool, with fictional customers,
  bookings, payments and reviews.
- **Look.** Apple-like, light theme by default.

## Open decisions awaiting the owner

- **Who sees the Payments report. Awaiting the owner's decision.** The
  Payments page (booking value, amount collected, outstanding and totals by
  method, for up to 366 days) is gated on `payments.record`, which staff hold.
  So staff can currently see this report for the locations they are assigned
  to. The spec (section 3.2) gives staff "limited" analytics and keeps all
  financial records for the owner, so this may be more than intended. The
  alternative is to gate the report summary on `analytics.view` (owner and
  manager) and keep the per-booking payment ledger, which staff need in order
  to record payments, on `payments.record`. Changing it is small: one
  permission check on the page and its data loader.
