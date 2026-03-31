create table if not exists public.trade_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  traded_on date not null,
  tickers text not null,
  pnl_amount numeric(12, 2) not null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists trade_calendar_entries_user_id_traded_on_idx
on public.trade_calendar_entries(user_id, traded_on desc, created_at desc);

drop trigger if exists trade_calendar_entries_set_updated_at on public.trade_calendar_entries;
create trigger trade_calendar_entries_set_updated_at
before update on public.trade_calendar_entries
for each row
execute function public.set_updated_at();

alter table public.trade_calendar_entries enable row level security;

drop policy if exists "trade_calendar_entries_select_own" on public.trade_calendar_entries;
create policy "trade_calendar_entries_select_own"
on public.trade_calendar_entries
for select
using (auth.uid() = user_id);

drop policy if exists "trade_calendar_entries_insert_own" on public.trade_calendar_entries;
create policy "trade_calendar_entries_insert_own"
on public.trade_calendar_entries
for insert
with check (auth.uid() = user_id);

drop policy if exists "trade_calendar_entries_update_own" on public.trade_calendar_entries;
create policy "trade_calendar_entries_update_own"
on public.trade_calendar_entries
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.trade_capture_drafts (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  traded_on date not null,
  tickers text,
  pnl_amount numeric(12, 2),
  notes text,
  source_message text,
  status text not null check (status in ('pending_confirmation', 'collecting_details')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists trade_capture_drafts_user_id_updated_at_idx
on public.trade_capture_drafts(user_id, updated_at desc);

drop trigger if exists trade_capture_drafts_set_updated_at on public.trade_capture_drafts;
create trigger trade_capture_drafts_set_updated_at
before update on public.trade_capture_drafts
for each row
execute function public.set_updated_at();

alter table public.trade_capture_drafts enable row level security;

drop policy if exists "trade_capture_drafts_select_own" on public.trade_capture_drafts;
create policy "trade_capture_drafts_select_own"
on public.trade_capture_drafts
for select
using (auth.uid() = user_id);

drop policy if exists "trade_capture_drafts_insert_own" on public.trade_capture_drafts;
create policy "trade_capture_drafts_insert_own"
on public.trade_capture_drafts
for insert
with check (auth.uid() = user_id);

drop policy if exists "trade_capture_drafts_update_own" on public.trade_capture_drafts;
create policy "trade_capture_drafts_update_own"
on public.trade_capture_drafts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "trade_capture_drafts_delete_own" on public.trade_capture_drafts;
create policy "trade_capture_drafts_delete_own"
on public.trade_capture_drafts
for delete
using (auth.uid() = user_id);
