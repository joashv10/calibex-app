-- 011: your water bottle's size, so "Add a bottle" logs the right ml.
-- Each drinks row stores its own volume_ml, so changing this never rewrites history.
alter table public.user_settings
  add column bottle_ml smallint not null default 500 check (bottle_ml between 100 and 3000);
