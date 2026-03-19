-- Backfill list_alerts schema for older environments that predate the label column.
alter table if exists public.list_alerts
  add column if not exists label text;
