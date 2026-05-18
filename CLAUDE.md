# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Run in production
npm start

# Run in development (auto-restart on changes)
npm run dev
```

There is no test suite and no linter configured. Manual browser testing is the only verification path.

## Environment Setup

Copy `.env.example` to `.env`. Required variables:

| Variable | Source |
|---|---|
| `SUPABASE_URL` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase `service_role` key (NOT anon key) |
| `JWT_SECRET` | Any random 32+ char string |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | dashboard.plaid.com → Developers → Keys |
| `PLAID_ENV` | `sandbox` (local dev) or `production` (live) |
| `SPLITWISE_CONSUMER_KEY` / `SPLITWISE_CONSUMER_SECRET` | splitwise.com/apps |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `APP_URL` | `http://localhost:3000` locally, Render URL in production |

Database schema: run the full contents of `database.sql` in the Supabase SQL Editor once to initialize.

## Architecture

```
Browser
  app.html    ← complete frontend: HTML + inline CSS + inline JavaScript
              (all 5 tabs, 13+ modals, global state, all render functions, API layer)
  index.html  ← login/signup page (self-contained, no external JS dependencies)

Backend:
  server.js   ← Express API, auth, all CRUD routes, Plaid, Splitwise, AI

Database:
  Supabase (PostgreSQL) — all persistent data
```

The frontend is **not a framework app** — it is vanilla JS with no bundler, no module system, and no build step. All JavaScript lives in a single inline `<script>` block at the bottom of `app.html` (starting around line 1099). The only external script loaded is the Plaid Link CDN library.

## Critical Data Separation Rule

This is the most important invariant in the codebase and must never be broken:

- **`S.earnings[]`** = manual logs ONLY (Uber/Lyft/Cash entered by the user). Plaid never writes here.
- **`S.expenses[]`** = Plaid bank transactions ONLY. Manual logs never go here.
- **Daily target reads from `S.bills[]` and `S.debts[]` ONLY** — it does not use `expenses`.

Plaid transactions with `is_income: true` (deposits/credits) live in `S.expenses` but are excluded from spending totals everywhere using `!e.is_income`. In Plaid's data model, `amount < 0` means money coming in.

## State and API Layer

**Global state** (inline in `app.html`): `S` holds `earnings`, `expenses`, `bills`, `onetime`, `debts`, `splitwise`, `accounts`, `rules`, `budgets`, `settings`, `shifts`.

**`req(path, opts)`** (inline in `app.html`): central fetch wrapper that injects `Authorization: Bearer <token>` and handles 401 by calling `logout()`. Returns parsed JSON or `null` on error.

**localStorage cache**: `saveLocal()` / `loadLocal()` snapshot the entire `S` object to `pb_state`. This enables instant render on page load before API calls complete.

**Auth**: JWT stored in `localStorage` as `pb_token`. Token is read by `tok()`, user profile by `usr()`. All API routes on the backend use the `auth` middleware that verifies the JWT.

## Daily Target Formula

Implemented in `calcDailyTarget()` (inline in `app.html`):

1. Overdue bills (past due, unpaid) ÷ days left in month
2. Each upcoming bill ÷ days until that bill's due day
3. Each one-time payment ÷ days until its due date
4. Next month rent ($2,084) ÷ days left — **skipped if a bill named "rent" already exists** (prevents double-counting)
5. Splitwise monthly contribution (`S.settings.sw_monthly`) ÷ 30
6. Daily ops fixed: `(1191 + 400 + 1000) / 30 = $86.37/day`

Result = `max(daily_quota, totalPerDay - todayEarned + todaySpent)`

Always use `refreshDate()` before accessing `_todayStr`, `_todayDay`, etc. — these are script-level cached values that must be fresh.

## Merchant Rules

When a user recategorizes a Plaid transaction and chooses "apply to all", the merchant key (first 30 chars of lowercased description) is stored in `S.rules` (a `{ key: category }` map). Rules are:
- Persisted to the `users.rules` JSONB column via `POST /api/rules`
- Applied client-side in `syncPlaid()` on every sync
- Applied server-side in `GET /api/plaid/transactions` as a safety net

## Backend API Routes

All routes require JWT auth except `/api/auth/signup` and `/api/auth/login`.

| Prefix | Purpose |
|---|---|
| `/api/auth/*` | Signup, login — returns JWT |
| `/api/earnings` | CRUD for manual earnings (always `is_manual: true`) |
| `/api/bills` | CRUD for recurring monthly bills |
| `/api/onetime` | CRUD for one-time payments |
| `/api/debts` | GET / POST / PATCH for manual debts (no DELETE endpoint yet) |
| `/api/settings` | GET/PUT user settings + budget limits |
| `/api/rules` | GET/POST merchant categorization rules |
| `/api/shifts` | POST shift log entries (no GET endpoint — shifts load from localStorage only) |
| `/api/plaid/*` | Link token, token exchange, transactions sync, accounts, reset-sync |
| `/api/splitwise/*` | OAuth initiation, callback, balances |
| `/api/ai/*` | Briefing (GET), chat (POST), budget suggestions (POST) |

The Plaid sync uses cursor-based pagination (`transactionsSync`) and stores the cursor per `plaid_tokens` row. `POST /api/plaid/reset-sync` nulls all cursors and deletes stored transactions to force a full re-fetch.

## AI Integration

Model used: `claude-sonnet-4-5` (hardcoded in `server.js`). Three endpoints:
- **Briefing** (`GET /api/ai/briefing`): personalized morning summary, cached client-side for 30 minutes in `localStorage` (`pb_brief`).
- **Chat** (`POST /api/ai/chat`): answers finance questions; the frontend builds the context string from `S` before calling.
- **Budget suggestions** (`POST /api/ai/budget`): analyzes 3 months of `S.expenses`, returns `{ budgets, flags }` JSON.

All AI endpoints expect Claude to return raw JSON (no markdown fences). The backend strips ` ```json ``` ` wrappers before `JSON.parse`.

## Theme

Theme (dark/light) is time-based: **day mode 6am–6pm**, night mode otherwise. Applied by toggling the `day` class on `<html>` every minute. All color tokens are CSS variables defined in `app.html`'s inline `<style>` block.

## Deployment

Hosted on Render (free tier — sleeps after 15 min inactivity, ~30-60s cold start). GitHub push triggers automatic redeploy. Build command: `npm install`. Start command: `node server.js`.

## Known Gaps (as of current codebase)

- `GET /api/shifts` does not exist — shift history persists in localStorage only and is lost on new devices
- `DELETE /api/debts/:id` does not exist — debts can be added and edited but not removed
- `sw_monthly` (Splitwise monthly contribution) is saved to `S.settings` and used in target calc, but the `PUT /api/settings` handler does not persist it to the database — it survives in localStorage only
- Google OAuth button exists in `index.html` but `GET /api/auth/google-url` is not implemented in `server.js`
- RLS is enabled on all 9 Supabase tables but no policies are defined — the backend uses the `service_role` key exclusively so this works, but provides no row-level protection at the database layer
