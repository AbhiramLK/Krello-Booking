# Krello

Krello is a booking platform for recreational venues in India: snooker halls, gaming lounges, swimming pools, turfs and courts. Customers find a venue, see live availability and send a booking request that is verified by a one-time code on their phone. The venue's team approves or declines the request, enters phone and walk-in bookings, blocks time and records payments taken at the venue.

This repository holds the first working slice of that product: the public marketplace, the booking request flow, the customer account and the business dashboard, running on demo data.

## Prerequisites

- Node.js 22 or newer
- pnpm 10 (`corepack enable` sets it up from the version pinned in `package.json`)

No Docker and no separate database install: development and tests use an embedded PostgreSQL server that `pnpm` starts for you.

## First run

```bash
pnpm install
cp .env.example .env        # on Windows PowerShell: Copy-Item .env.example .env
```

Then, in one terminal, start the database and leave it running:

```bash
pnpm db:start
```

In a second terminal, create the tables and load the demo data:

```bash
pnpm db:reset               # applies the migrations, then replaces the data with the demo seed
pnpm dev:all                # database (if not already running), migrations, web app and worker
```

Open <http://localhost:3000>. Stop `dev:all` with Ctrl+C.

After the first run you only need `pnpm dev:all`: it starts the database itself when it is not running, applies any new migrations and starts the web app and the background worker together. If you already have `pnpm db:start` running, it uses that database and leaves it running when you stop.

Settings live in `.env` (copied from `.env.example`): the database URL, the secret that signs session cookies, and the phone number treated as platform super-admin. Change the secret in any shared environment.

`pnpm db:reset` replaces everything in the database with the seed. Run it whenever you want a clean demo.

## Demo logins

The seed creates three fictional venues in Bengaluru (`cue-masters`, `respawn-lounge`, `bluelane-aquatics`), about seven weeks of bookings and payments, and these accounts. All names and numbers are made up.

| Role | Phone | Notes |
| --- | --- | --- |
| Super-admin | +91 90000 00001 | Platform admin (screens for it are not built yet) |
| Owner | +91 90000 00011 | Cue Masters |
| Owner | +91 90000 00012 | Respawn Lounge |
| Owner | +91 90000 00013 | Bluelane Aquatics |
| Manager | +91 90000 00021 | Cue Masters |
| Staff | +91 90000 00031 | Cue Masters, Indiranagar location only |
| Customer | +91 90000 00091 | Has past and upcoming bookings |

Sign in at `/login`. Owners, managers and staff land on `/dashboard`; customers land on `/account`. Any other valid Indian mobile number works too: it creates a new customer account.

## How the one-time code works in demo mode

There is no SMS provider yet. When you ask for a code, the server prints it to the terminal where the web app runs (`[otp] +919876543210 → 123456`), and the page also shows it in a notice: "Demo mode: your code is 123456". Type it into the six boxes (you can paste all six at once). Codes last five minutes, allow five attempts, and a new one can be requested every 30 seconds. A real SMS sender replaces the console one by implementing the `OtpSender` interface in `packages/core/src/auth.ts`.

## The worker

`pnpm worker` runs the background jobs every 15 seconds (set `WORKER_INTERVAL_MS` to change it): it expires booking requests the venue did not answer in time and releases their slots, delivers queued notifications to the in-app bell, and clears old one-time codes. `pnpm worker -- --once` runs a single cycle and exits, which is what a cloud scheduler would call. `pnpm dev:all` starts it for you.

Without the worker the app still runs, but notifications are not delivered, and an overdue request is only recorded as expired when its status page is opened.

## Tests

```bash
pnpm test        # unit and integration tests (Vitest) against a throwaway PostgreSQL it boots itself
pnpm typecheck   # TypeScript, all packages
pnpm e2e         # one end-to-end booking journey in a real browser (Playwright)
```

`pnpm e2e` builds the web app, then serves it on a free port against its own freshly seeded throwaway database. It never touches the development database. Every run builds the app first, which takes a few minutes; set `E2E_SKIP_BUILD=1` to reuse the previous build when you have only changed the test.

It drives the installed Microsoft Edge, so nothing needs downloading. Pick another browser with the `PW_CHANNEL` environment variable:

```bash
PW_CHANNEL=chrome pnpm e2e         # Google Chrome
PW_CHANNEL=chromium pnpm e2e       # Playwright's own Chromium (run `pnpm exec playwright install chromium` once)
```

On Windows PowerShell set the variable first: `$env:PW_CHANNEL = "chrome"`, then `pnpm e2e`. (Use `chromium` rather than an empty value for the bundled browser; PowerShell treats an empty value as "unset".)

## Folder map

| Folder | What is in it |
| --- | --- |
| `apps/web` | The Next.js app: marketplace (`/`), venue pages, booking status (`/booking/...`), customer account (`/account`), business dashboard (`/dashboard`) |
| `packages/database` | Schema, migrations and the database client |
| `packages/pricing` | Price calculation from a venue's pricing rules |
| `packages/booking-engine` | Availability, creating bookings, status changes, blocks and payments: the only code that writes bookings |
| `packages/core` | Sign-in and sessions, permissions, marketplace queries, requests, dashboards, notifications |
| `scripts` | Development database, demo seed, background worker, `dev:all` and the end-to-end server |
| `e2e` | The Playwright test |
| `docs` | The product spec (`V1_SPEC.md`), settled decisions (`decisions.md`) and implementation plans |

## Not built yet

Super-admin and business verification screens, subscriptions and plan limits, reviews, favourites, browser push, analytics screens, editors for resources, schedules, pricing, staff and the business profile, and production hosting. Each gets its own plan after this one. The seed creates the data those editors would.
