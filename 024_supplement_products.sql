-- Supplement products: what one tablet / capsule / scoop of a named brand contains,
-- found by a web search of that product (api/supplement) and kept with its source link.
-- One product per supplement name (the brand you currently take); a new brand replaces it.
-- supplements.nutrients is a snapshot scaled to the dose at log time, so a later product
-- change never rewrites history. Unknown = no snapshot (null), never zeros.
-- Applied via Supabase MCP as migration "supplement_products".
create table if not exists public.supplement_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,              -- the supplement name as logged ("Multivitamin")
  brand text not null,             -- as the user typed it ("HealthKart HK Vitals")
  product text,                    -- the product the search matched
  unit text not null,              -- what one unit is: tablet | caps | scoop | g | ml
  per_unit jsonb not null default '[]'::jsonb, -- [{key, label, amount, unit}] per ONE unit
  source_url text,                 -- page the numbers came from; null = typed by hand
  note text,                       -- e.g. "magnesium as glycinate, elemental shown"
  looked_up_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists supplement_products_name_key on public.supplement_products (lower(name));
alter table public.supplement_products enable row level security;
drop policy if exists supplement_products_owner on public.supplement_products;
create policy supplement_products_owner on public.supplement_products for all
  using ((select private.is_owner())) with check ((select private.is_owner()));

alter table public.supplements add column if not exists product_id uuid references public.supplement_products(id) on delete set null;
alter table public.supplements add column if not exists nutrients jsonb; -- [{key, label, amount, unit}] for the dose taken

-- Applied as migration "supplements_brand_snapshot": the brand at log time, so a later
-- brand switch doesn't relabel old rows that carry the old brand's numbers.
alter table public.supplements add column if not exists brand text;
