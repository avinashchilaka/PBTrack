# Livvy — Gig Driver Finance Dashboard

> Personal finance command center built specifically for Uber/Lyft drivers.  
> Tracks daily earnings manually, auto-imports bank spending via Plaid,  
> calculates a smart daily target based on real bills and debts, and uses  
> Claude AI for briefings, chat, and budget suggestions.

---

## What This App Does

Livvy is a full-stack web app accessible from any device via a URL.  
It is **not** a generic finance app — every feature is designed around  
the reality of gig driving: variable income, daily targets, shift tracking,  
and managing multiple debts alongside monthly bills.

### Core Features

**Home Tab**
- Smart daily target ring — shows exactly how much to earn today
- Target is calculated from overdue bills + upcoming bills + one-time payments + next month rent + daily ops ($86.37) + Splitwise contribution — updated in real time
- AI morning briefing from Claude — personalized daily insights
- Dismissable alerts for overdue bills, bills due soon, and goal hits
- Break-even tracker — are you in profit or deficit today?
- Upcoming bills preview + recent Plaid transactions

**Earnings Tab — Manual Logs Only**
- Log Uber, Lyft, Cash, Other earnings manually
- Shift timer — start/stop with live hours + $/hr display
- Editable shift log — set exact start/end times if you forgot to start
- Best earning days chart (Mon–Sun average)
- Weekly projection based on current daily average
- Monthly goal progress bar
- Full earnings history with edit and delete

**Spending Tab — Plaid Transactions Only**
- All bank transactions auto-imported from Plaid
- Donut chart showing spending breakdown by category
- 7-day cash flow bar chart (earnings vs spending side by side)
- AI budget suggestions — Claude analyzes 3 months of history and suggests limits per category AND flags high-spend merchants
- Budget progress bars with color-coded limits
- Category filter chips — tap to see only food, transport, etc.
- Tap any transaction to edit its category
- Merchant rules — when you change a category, choose to apply it to ALL past, present, and future transactions from that merchant permanently

**Bills Tab — All Obligations**
- Recurring monthly bills (rent, insurance, subscriptions)
- One-time payments (vehicle registration, repairs, borrowed money)
- Both types shown in one list sorted by due date
- Pay / Skip / Undo skip / Edit on every item
- Paying a bill immediately recalculates the home target
- Auto-detection of recurring charges from Plaid transactions

**More Tab**
- Bank accounts from Plaid with live balances
- Splitwise balances (who you owe)
- Manual debts
- AI Chat — ask anything about your finances
- Settings — monthly goal, daily quota, Splitwise monthly contribution
- Backup and restore data (JSON export/import)

---

## Architecture

```
Browser (app.html — single self-contained file)
    │
    ├── Manual earnings → S.earnings[] (never touched by Plaid)
    ├── Plaid transactions → S.expenses[] (never touched by manual log)
    ├── Bills + one-time → S.bills[] + S.onetime[]
    └── Merchant rules → S.rules{} (applied on every sync)
    │
    ↓
Node.js server (server.js) on Render
    │
    ├── Supabase (PostgreSQL) — stores all user data
    ├── Plaid API — bank transaction sync
    ├── Splitwise API — debt balances
    └── Anthropic Claude API — briefing, chat, budget suggestions
```

**Critical rule enforced in both frontend and backend:**  
`earnings[]` = manual logs ONLY — Plaid NEVER writes here  
`expenses[]` = Plaid ONLY — manual logs NEVER go here  
Daily target reads from `bills[]` and `debts[]` ONLY

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single-file HTML app (`app.html`) — HTML + CSS + JavaScript all inline, no build step |
| Backend | Node.js + Express (`server.js`) |
| Database | Supabase (PostgreSQL) |
| Auth | JWT (`bcryptjs` + `jsonwebtoken`) |
| Bank sync | Plaid (`transactionsSync` cursor-based) |
| Debt tracking | Splitwise OAuth API |
| AI | Anthropic Claude (`claude-sonnet-4-5`) |
| Hosting | Render (free tier) |
| Fonts | Inter + DM Mono (Google Fonts CDN) |
| Merchant logos | Clearbit Logo API (free, client-side) |

---

## Files in This Repo

| File | Purpose |
|---|---|
| `app.html` | Complete frontend — all 5 tabs, 13+ modals, all CSS and JavaScript inline |
| `index.html` | Login and signup page (self-contained) |
| `server.js` | Backend API — auth, earnings, bills, Plaid, Splitwise, AI |
| `database.sql` | Supabase schema — run once in SQL Editor to initialize |
| `package.json` | Node.js dependencies and start scripts |
| `.env.example` | Environment variable template — copy to `.env` |
| `.gitignore` | Keeps `.env` and `node_modules` out of GitHub |
| `CLAUDE.md` | Guidance for AI coding assistants |
| `README.md` | This file |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values.  
Never commit `.env` to GitHub — it is in `.gitignore`.

```
SUPABASE_URL              = https://xxxx.supabase.co
SUPABASE_SERVICE_KEY      = eyJ... (service_role key — NOT anon key)
JWT_SECRET                = any long random string (32+ chars)
PLAID_CLIENT_ID           = from dashboard.plaid.com → Developers → Keys
PLAID_SECRET              = sandbox or production secret from Plaid dashboard
PLAID_ENV                 = sandbox (local dev) or production (live)
SPLITWISE_CONSUMER_KEY    = from splitwise.com/apps
SPLITWISE_CONSUMER_SECRET = from splitwise.com/apps
ANTHROPIC_API_KEY         = sk-ant-... from console.anthropic.com
APP_URL                   = http://localhost:3000 (local) or your Render URL (production)
PORT                      = 3000
```

---

## Database Tables

| Table | What it stores |
|---|---|
| `users` | Accounts, settings (`monthly_goal`, `daily_quota`), budget limits (JSONB), merchant rules (JSONB) |
| `earnings` | Manual earnings only (Uber/Lyft/Cash) — `is_manual` always true |
| `bills` | Recurring monthly bills |
| `onetime_payments` | One-time payments with a specific due date |
| `debts` | Manual debts |
| `transactions` | Plaid bank transactions only — spending and income, never manual earnings |
| `plaid_tokens` | Plaid access tokens per institution, plus sync cursor |
| `splitwise_tokens` | Splitwise OAuth access token per user |
| `shifts` | Shift log history (start time, end time, hours, earnings, $/hr) |

---

## Setup Instructions (First Time)

### 1. Supabase
1. Go to supabase.com and create a free project
2. Go to SQL Editor → New Query
3. Paste the entire contents of `database.sql` and click Run
4. Go to Settings → API and copy:
   - Project URL → `SUPABASE_URL`
   - service_role key (the long one) → `SUPABASE_SERVICE_KEY`

### 2. Plaid
1. Go to dashboard.plaid.com → Developers → Keys
2. Copy Client ID → `PLAID_CLIENT_ID`
3. For local dev: copy Sandbox secret → `PLAID_SECRET`, set `PLAID_ENV=sandbox`
4. For production: copy Production secret → `PLAID_SECRET`, set `PLAID_ENV=production`

### 3. Splitwise
1. Go to splitwise.com → Apps → Register your application
2. App name: Livvy
3. Homepage URL: your Render app URL
4. Callback URL: `https://YOUR_RENDER_URL/api/splitwise/callback`
5. Copy Consumer Key → `SPLITWISE_CONSUMER_KEY`
6. Copy Consumer Secret → `SPLITWISE_CONSUMER_SECRET`

### 4. Anthropic
1. Go to console.anthropic.com
2. API Keys → Create Key → name it Livvy
3. Copy the key → `ANTHROPIC_API_KEY`
4. Add credit to your account

### 5. GitHub
1. Push all files to `github.com/avinashchilaka/Livvy`
2. Do not push `.env` — it is gitignored

### 6. Render
1. Go to render.com → New Web Service
2. Connect `github.com/avinashchilaka/Livvy`
3. Settings:
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: Free
4. Add all environment variables from your `.env` file
5. Click Deploy Web Service

---

## Updating the App

When you want to add new features or fix something:
1. Make changes to `app.html` (frontend) or `server.js` (backend)
2. Push to GitHub
3. Render auto-detects the change and redeploys
4. New version is live in 3-5 minutes

---

## Connecting Banks (After Deploy)

1. Open the app in a browser
2. Go to the Spending tab
3. Tap Connect Bank
4. Plaid Link opens — log in with your real bank credentials
5. Transactions start importing automatically
6. Merchant rules apply on every future sync

---

## Smart Daily Target Formula

The home target ring is calculated using this 6-part formula:

```
1. Overdue bills (past due, unpaid) ÷ days left in month
2. Each upcoming bill ÷ days until that bill is due
3. One-time payments ÷ days until each payment is due
4. Next month rent ($2,084) ÷ days left in month  [skipped if rent is already a bill]
5. Splitwise monthly contribution setting ÷ 30
6. Daily ops ($86.37/day fixed)

Total per day - today's earnings already logged + today's spending
= Your real target for today
```

If you're behind (overdue bills) the number goes up automatically.  
If you log earnings, the number goes down in real time.  
Paying a bill immediately recalculates the target.

---

## Merchant Rules

When you tap a Plaid transaction and change its category:
- A popup asks: "Apply to ALL transactions from this merchant?"
- If yes: every past, present, and future transaction from that merchant gets the new category
- Rules are saved to the `users.rules` JSONB column and re-applied on every Plaid sync
- Example: Change "Tesla Supercharger" from "other" to "transportation" once — it stays forever

---

## Version History

| Version | Description |
|---|---|
| v1.x | Original single HTML file, localStorage only, no backend |
| v2.x | Added backend + Plaid + AI but broke daily target formula |
| v3.x | Complete rebuild — strict data separation, self-contained app.html, all features working |
