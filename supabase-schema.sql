-- ============================================================
-- Taaza Resort — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → Run
-- ============================================================

-- Key-value store for admin broadcast state (menu items, delivery foods,
-- swim tickets, dine-in settings, guests, staff, attendance, loyalty,
-- reviews, stock) — one row per key, whole array/object stored as JSON.
-- Daily sales and Dine-In tables are deliberately NOT here; see
-- taaza_daily_sales and taaza_tables below.
create table if not exists taaza_sync (
  key         text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Key-value store for misc metadata (notification badge counters,
-- one-time migration flags).
create table if not exists taaza_meta (
  key         text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- One row per reservation.
create table if not exists taaza_reservations (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- One row per delivery order.
create table if not exists taaza_orders (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- One row per QR table order.
create table if not exists taaza_qr_orders (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- One row per daily-sales record (table bills, counter sales, swim
-- tickets, delivery orders, QR orders). Deliberately NOT stored in
-- taaza_sync as a single blob: multiple billing stations write to this
-- log around the same moment, and a whole-array overwrite would let one
-- station's write silently clobber another's. One row per sale avoids
-- that race entirely.
create table if not exists taaza_daily_sales (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- One row per Dine-In table (id = table number, e.g. '1'..'6'). A row
-- exists only while that table is occupied or has a bill awaiting
-- payment; completing payment deletes the row, so a page refresh (or a
-- fresh customer QR order) can never read back a stale/paid-out bill.
-- Deliberately NOT a single taaza_sync blob for the same reason as
-- taaza_daily_sales above: two tables' writes — or admin's own clear
-- racing a customer's QR order — must never be able to clobber or
-- resurrect each other.
create table if not exists taaza_tables (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Row Level Security
-- Matches the previous Firestore rules (allow read, write: if true) —
-- fully open, honor-system access. admin.html's password gate is
-- client-side only and was never enforced at the database layer,
-- so this carries over the exact same security posture, not a new gap.
-- ------------------------------------------------------------
alter table taaza_sync          enable row level security;
alter table taaza_meta          enable row level security;
alter table taaza_reservations  enable row level security;
alter table taaza_orders        enable row level security;
alter table taaza_qr_orders     enable row level security;
alter table taaza_daily_sales   enable row level security;
alter table taaza_tables        enable row level security;

create policy "public full access" on taaza_sync
  for all using (true) with check (true);
create policy "public full access" on taaza_meta
  for all using (true) with check (true);
create policy "public full access" on taaza_reservations
  for all using (true) with check (true);
create policy "public full access" on taaza_orders
  for all using (true) with check (true);
create policy "public full access" on taaza_qr_orders
  for all using (true) with check (true);
create policy "public full access" on taaza_daily_sales
  for all using (true) with check (true);
create policy "public full access" on taaza_tables
  for all using (true) with check (true);

-- ------------------------------------------------------------
-- Realtime — so postgres_changes subscriptions work like Firestore's
-- onSnapshot listeners.
-- ------------------------------------------------------------
alter publication supabase_realtime add table taaza_sync;
alter publication supabase_realtime add table taaza_meta;
alter publication supabase_realtime add table taaza_reservations;
alter publication supabase_realtime add table taaza_orders;
alter publication supabase_realtime add table taaza_qr_orders;
alter publication supabase_realtime add table taaza_daily_sales;
alter publication supabase_realtime add table taaza_tables;

-- ------------------------------------------------------------
-- Keep updated_at current on every UPDATE.
-- The client now does incremental "give me rows changed since X" pulls
-- (updated_at based) instead of re-downloading whole tables on a timer,
-- which is what was exhausting the egress quota. Without this trigger,
-- updated_at only reflects INSERT time, so an edit to an existing row
-- (e.g. marking a bill paid) would be missed by a catch-up pull after a
-- realtime gap. Run this block once in the SQL Editor.
-- ------------------------------------------------------------
create or replace function taaza_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'taaza_sync','taaza_meta','taaza_reservations','taaza_orders',
    'taaza_qr_orders','taaza_daily_sales','taaza_tables'
  ] loop
    execute format('drop trigger if exists trg_touch_updated_at on %I', t);
    execute format(
      'create trigger trg_touch_updated_at before update on %I
         for each row execute function taaza_touch_updated_at()', t);
  end loop;
end $$;
