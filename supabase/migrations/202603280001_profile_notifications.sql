create table if not exists public.profile_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  field_key text not null,
  change_type text not null check (change_type in ('added', 'updated', 'removed')),
  title text not null,
  detail text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists profile_notifications_user_id_created_at_idx
on public.profile_notifications(user_id, created_at desc);

alter table public.profile_notifications enable row level security;

drop policy if exists "profile_notifications_select_own" on public.profile_notifications;
create policy "profile_notifications_select_own"
on public.profile_notifications
for select
using (auth.uid() = user_id);

drop policy if exists "profile_notifications_insert_own" on public.profile_notifications;
create policy "profile_notifications_insert_own"
on public.profile_notifications
for insert
with check (auth.uid() = user_id);
