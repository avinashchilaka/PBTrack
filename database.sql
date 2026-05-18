-- PBTrack v3 — Full Database Schema
-- Run in Supabase → SQL Editor → New Query

-- Users
create table if not exists users (
  id            uuid default gen_random_uuid() primary key,
  name          text not null,
  email         text unique not null,
  password_hash text not null,
  monthly_goal  numeric default 9500,
  daily_quota   numeric default 400,
  sw_monthly    numeric default 0,
  budgets       jsonb,
  rules         jsonb,
  created_at    timestamptz default now()
);

-- Earnings (manual only — Plaid never writes here)
create table if not exists earnings (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references users(id) on delete cascade,
  amount     numeric not null,
  platform   text default 'Other',
  date       date not null,
  note       text,
  is_manual  boolean default true,
  created_at timestamptz default now()
);

-- Bills (recurring monthly)
create table if not exists bills (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references users(id) on delete cascade,
  name       text not null,
  amount     numeric not null,
  due_day    integer not null,
  category   text default 'other',
  paid       boolean default false,
  skipped    boolean default false,
  created_at timestamptz default now()
);

-- One-time payments (vehicle reg, borrowed money, repairs)
create table if not exists onetime_payments (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references users(id) on delete cascade,
  name       text not null,
  amount     numeric not null,
  due_date   date not null,
  notes      text,
  paid       boolean default false,
  skipped    boolean default false,
  created_at timestamptz default now()
);

-- Debts (manual)
create table if not exists debts (
  id              uuid default gen_random_uuid() primary key,
  user_id         uuid references users(id) on delete cascade,
  name            text not null,
  amount          numeric not null,
  original        numeric,
  monthly_payment numeric default 0,
  notes           text,
  created_at      timestamptz default now()
);

-- Transactions (Plaid only — expenses only, never earnings)
create table if not exists transactions (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references users(id) on delete cascade,
  plaid_id    text unique,
  date        date not null,
  amount      numeric not null,
  description text,
  category    text default 'other',
  account_id  text,
  institution text,
  is_plaid    boolean default false,
  is_income   boolean default false,
  created_at  timestamptz default now()
);

-- Plaid tokens
create table if not exists plaid_tokens (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references users(id) on delete cascade,
  institution  text,
  access_token text not null,
  item_id      text,
  cursor       text,
  created_at   timestamptz default now(),
  unique(user_id, institution)
);

-- Splitwise tokens
create table if not exists splitwise_tokens (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references users(id) on delete cascade unique,
  access_token text not null,
  created_at   timestamptz default now()
);

-- Shifts
create table if not exists shifts (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references users(id) on delete cascade,
  date       date not null,
  start_time text,
  end_time   text,
  hours      numeric,
  earned     numeric,
  per_hour   numeric,
  notes      text,
  created_at timestamptz default now()
);

-- RLS
alter table users             enable row level security;
alter table earnings          enable row level security;
alter table bills             enable row level security;
alter table onetime_payments  enable row level security;
alter table debts             enable row level security;
alter table transactions      enable row level security;
alter table plaid_tokens      enable row level security;
alter table splitwise_tokens  enable row level security;
alter table shifts            enable row level security;

-- Indexes
create index if not exists idx_earn_user_date    on earnings(user_id, date desc);
create index if not exists idx_txn_user_date     on transactions(user_id, date desc);
create index if not exists idx_txn_plaid_id      on transactions(plaid_id);
create index if not exists idx_bills_user        on bills(user_id, due_day);
create index if not exists idx_onetime_user      on onetime_payments(user_id, due_date);
create index if not exists idx_debts_user        on debts(user_id);
create index if not exists idx_shifts_user_date  on shifts(user_id, date desc);
