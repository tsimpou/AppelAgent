-- Live list monitoring tables
create extension if not exists pgcrypto;

create table if not exists public.live_lists (
  list_id text primary key,
  list_name text not null,
  campaign_id text not null,
  campaign_name text not null,
  total_count integer not null default 0,
  remaining_count integer not null default 0,
  active boolean not null default true,
  last_call_time timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.list_alerts (
  id uuid primary key default gen_random_uuid(),
  list_id text not null references public.live_lists(list_id) on delete cascade,
  threshold integer not null,
  label text,
  notified_at timestamptz,
  active boolean not null default true
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'list_alerts_list_id_unique'
  ) then
    alter table public.list_alerts
      add constraint list_alerts_list_id_unique unique (list_id);
  end if;
end
$$;

create index if not exists idx_live_lists_active_remaining
  on public.live_lists(active, remaining_count);

create index if not exists idx_list_alerts_active
  on public.list_alerts(active);

create or replace function public.set_live_lists_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_live_lists_updated_at on public.live_lists;
create trigger trg_live_lists_updated_at
before update on public.live_lists
for each row
execute function public.set_live_lists_updated_at();
