-- Species as a first-class entity per user. See DECISIONS.md Entry #13.
--
-- Each user maintains their own list of species ("Rose", "Hibiscus", etc.).
-- A plant references a species via species_id; the species's display_number
-- shows inside the plant's circle on the yard map. Numbers are stable —
-- deleting all plants of a species doesn't release its number, so re-adding
-- the species later gives it the original number back.
--
-- Two unique indexes enforce integrity at the DB layer:
--   * (user_id, lower(trim(common_name))) — no duplicate species per user
--   * (user_id, display_number) — no duplicate numbers per user
--
-- Migration safely handles existing plants by creating a species row for
-- each distinct user/common_name combination, then pointing each plant at
-- the matching species via the new species_id FK.

-- ── Species table ──────────────────────────────────────────────────────
create table public.species (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  common_name     text not null,
  scientific_name text,
  display_number  integer not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Case-insensitive, trimmed uniqueness. Inserting "Rose" when "rose"
-- already exists for this user will throw a unique-violation.
create unique index species_user_name_unique
  on public.species (user_id, lower(trim(common_name)));

-- Each user's display numbers are unique. Prevents accidentally
-- assigning the same number twice.
create unique index species_user_number_unique
  on public.species (user_id, display_number);

create index species_user_id_idx on public.species(user_id);

-- Reuse the touch_updated_at trigger function declared with gardens.
create trigger species_touch_updated_at
  before update on public.species
  for each row execute function public.touch_updated_at();

-- ── Species RLS ────────────────────────────────────────────────────────
-- Per-user ownership, same pattern as gardens.
alter table public.species enable row level security;

create policy "species_select_own"
  on public.species for select
  using (auth.uid() = user_id);

create policy "species_insert_own"
  on public.species for insert
  with check (auth.uid() = user_id);

create policy "species_update_own"
  on public.species for update
  using (auth.uid() = user_id);

create policy "species_delete_own"
  on public.species for delete
  using (auth.uid() = user_id);

-- ── Add species_id to plants ───────────────────────────────────────────
-- Nullable so existing plants without common_name stay valid. Future
-- migration may make this NOT NULL once all data has a species.
-- ON DELETE CASCADE: deleting a species removes all its plants — the
-- user explicitly chose "remove this from my list" (DECISIONS #13).
alter table public.plants
  add column species_id uuid references public.species(id) on delete cascade;

create index plants_species_id_idx on public.plants(species_id);

-- ── Data migration ─────────────────────────────────────────────────────
-- For each user's distinct named plant (case-insensitive trimmed),
-- create a species row with sequential display_number ordered by the
-- earliest plant of that species (so older species get lower numbers).
insert into public.species (user_id, common_name, display_number, created_at)
select
  added_by_user_id as user_id,
  -- Pick the earliest occurrence's casing as the canonical name.
  (array_agg(common_name order by created_at))[1] as common_name,
  -- Sequential numbers per user, ordered by first-appearance time.
  row_number() over (
    partition by added_by_user_id
    order by min(created_at)
  ) as display_number,
  min(created_at) as created_at
from public.plants
where common_name is not null and trim(common_name) != ''
group by added_by_user_id, lower(trim(common_name));

-- Point each existing plant at its corresponding species row. Plants
-- without a common_name (NULL or empty) stay species_id = NULL — they
-- won't appear in the legend until the user fixes them up via the app.
update public.plants p
set species_id = s.id
from public.species s
where s.user_id = p.added_by_user_id
  and p.common_name is not null
  and lower(trim(s.common_name)) = lower(trim(p.common_name));
