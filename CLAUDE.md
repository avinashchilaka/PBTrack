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
  app.html          ← dashboard shell (all 5 tabs + 13 modals)
  index.html        ← login/signup page
  styles.css        ← all styling, CSS design tokens, dark/light theme

Frontend JS (loaded as plain <script> tags in app.html):
  storage.js        ← saveLocal / loadLocal / logout
  ui-helpers.js     ← flash messages, sync indicator, modal open/close
  data-io.js        ← JSON backup export / import
  modals.js         ← modal open/close + tap-outside-to-dismiss
  txn-row.js        ← transaction row renderer, Clearbit logos, category icons
  target-calc.js    ← daily target formula + all earnings/spending calculations
  shift-timer.js    ← shift start/stop/tick/save
  plaid.js          ← Plaid Link flow, syncPlaid(), loadAccounts()
  ai.js             ← briefing card, AI chat, budget suggestions
  app.js            ← state object S, req() API wrapper, navigation, render fns, init

Backend:
  server.js         ← Express API, auth, all CRUD routes, Plaid, Splitwise, AI

Database:
  Supabase (PostgreSQL) — all persistent data
```

The frontend is **not a framework app** — it's vanilla JS with a single global state object `S` in `app.js`. All JS files share this global scope via script tags. There is no bundler, build step, or module system.

## Critical Data Separation Rule

This is the most important invariant in the codebase and must never be broken:

- **`S.earnings[]`** = manual logs ONLY (Uber/Lyft/Cash entered by the user). Plaid never writes here.
- **`S.expenses[]`** = Plaid bank transactions ONLY. Manual logs never go here.
- **Daily target reads from `S.bills[]` and `S.debts[]` ONLY** — it does not use `expenses`.

Plaid transactions with `is_income: true` (deposits/credits) live in `S.expenses` but are excluded from spending totals everywhere using `!e.is_income`. In Plaid's data model, `amount < 0` means money coming in.

## State and API Layer

**Global state** (`app.js`): `S` holds `earnings`, `expenses`, `bills`, `onetime`, `debts`, `splitwise`, `accounts`, `rules`, `budgets`, `settings`, `shifts`.

**`req(path, opts)`** (`app.js`): central fetch wrapper that injects `Authorization: Bearer <token>` and handles 401 by calling `logout()`. Returns parsed JSON or `null` on error.

**localStorage cache**: `saveLocal()` / `loadLocal()` snapshot the entire `S` object to `pb_state`. This enables instant render on page load before API calls complete.

**Auth**: JWT stored in `localStorage` as `pb_token`. Token is read by `tok()`, user profile by `usr()`. All API routes on the backend use the `auth` middleware that verifies the JWT.

## Daily Target Formula

Implemented in `target-calc.js → calcDailyTarget()`:

1. Overdue bills (past due, unpaid) ÷ days left in month
2. Each upcoming bill ÷ days until that bill's due day
3. Each one-time payment ÷ days until its due date
4. Next month rent ($2,084) ÷ days left — **skipped if a bill named "rent" already exists** (prevents double-counting)
5. Splitwise monthly contribution (`S.settings.sw_monthly`) ÷ 30
6. Daily ops fixed: `(1191 + 400 + 1000) / 30 = $86.37/day`

Result = `max(daily_quota, totalPerDay - todayEarned + todaySpent)`

Always use `refreshDate()` before accessing `_todayStr`, `_todayDay`, etc. — these are module-level cached values that must be fresh.

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
| `/api/debts` | CRUD for manual debts |
| `/api/settings` | GET/PUT user settings + budget limits |
| `/api/rules` | GET/POST merchant categorization rules |
| `/api/shifts` | POST shift log entries |
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

Theme (dark/light) is time-based: **day mode 6am–6pm**, night mode otherwise. Applied by toggling the `day` class on `<html>` every minute in `app.js`. All color tokens are CSS variables in `styles.css`.

## Deployment

Hosted on Render (free tier — sleeps after 15 min inactivity, ~30-60s cold start). GitHub push triggers automatic redeploy. Build command: `npm install`. Start command: `node server.js`.

The `supabase/functions/` directory contains legacy Deno edge functions (plaid-sync, splitwise-sync) that are **not used** — the active integrations are all in `server.js`.


## Livvy Edit Protocol

These rules are mandatory for all future work on Livvy.

### Source of truth
- Always inspect the current uploaded/checked-out Livvy files first before making any change.
- Treat the latest working file set as the only source of truth.
- Do not rely on prior chat memory when the actual file contents differ.
- If multiple similar artifacts exist, identify the exact active deploy file set before editing.

### Scope control
- This is an existing app, not a rewrite.
- One chat = one task.
- Do not batch unrelated fixes unless explicitly requested.
- Preserve all existing working features unless the requested task requires a targeted change.
- Do not do broad refactors, random cleanup, renames, or cosmetic drift.

### Architecture guardrails
- Frontend is vanilla JavaScript with plain script tags and no bundler.
- Backend is Express.
- Database is Supabase.
- supabase/functions/ is legacy/unused unless explicitly reactivated.
- Follow the existing global state and API patterns instead of inventing a new architecture.

### Critical financial invariants
- earnings[] is manual-only.
- expenses[] is Plaid-only.
- Never merge, auto-convert, or cross-populate these arrays unless explicitly requested.
- Preserve the daily target formula and its current logic.
- Preserve the rent double-counting guard.
- Preserve transfer exclusion behavior anywhere spending totals, budgets, targets, insights, or charts are derived.
- Preserve merchant-rule behavior from UI to localStorage to DB to Plaid sync.

### Change strategy
- Prefer the smallest safe patch.
- For risky areas, inspect first, explain the exact boundary, then patch only what is necessary.
- If a requested change expands into a larger dependency chain, stop and report the minimum safe boundary before proceeding.
- When extracting modules, move code verbatim where possible and avoid behavior changes during extraction.

### Verification requirements
Before claiming a task is complete, verify the exact affected paths and logic.
Always check the relevant functions, conditions, UI path, and dependent calculations.
For any finance-impacting change, explicitly verify:
- daily target inputs and totals
- transfer exclusions
- overdue bill logic
- merchant-rule persistence path
- bank-linked vs non-bank-linked states where relevant
- AI endpoint call path where relevant

### Preferred response format
Return output in concise, copy-paste-friendly form.
Do not paste full code unless explicitly asked.

Use exactly this format unless I request another one:

STATUS
Result:
Gaps found:
Patched:
Remaining risks:

FILES CHANGED
path — short change summary

FILES TO DOWNLOAD/UPLOAD
exact final file list

PROOF
exact functions/files/conditions checked

COPY-PASTE RELEASE NOTE
short bullet
short bullet
short bullet

### Safety rules
- If something is already correct, do not rewrite it.
- If verification shows no real issue, report that cleanly and make no code changes.
- If packaging/deploy artifacts are inconsistent, fix only the exact packaging issue.
- Keep all changes rollback-safe and cumulative.
- Maintain Livvy’s current mobile-first design language: clean, minimal, high-contrast, practical.
