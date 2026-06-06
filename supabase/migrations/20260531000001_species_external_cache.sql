-- Cache Perenual (or other external plant database) data on the species
-- row. See DECISIONS.md Entry #14.
--
-- After this migration, the add-plant flow populates these columns from
-- a Perenual lookup whenever a new species is created. Existing species
-- (created in V1-V5 before this feature) leave them NULL — they still
-- work but won't have height data for the color-by-height coloring,
-- which falls back to a neutral "unknown" gray.
--
-- Storing the full API response in `external_data` (jsonb) is a hedge:
-- it costs little and lets future features (watering, sunlight,
-- hardiness zone, plant images) pull data without another migration.

alter table public.species
  add column external_source text,           -- 'perenual', 'llm', 'manual', etc.
  add column external_id     text,           -- the ID in the external system
  add column height_ft_min   numeric,        -- min mature height, feet
  add column height_ft_max   numeric,        -- max mature height, feet
  add column external_data   jsonb;          -- full cached API response

-- Partial index for fast "is this user already tracking this external
-- plant?" lookups during the add-plant flow. WHERE clause keeps the
-- index small (excludes legacy/manual species with NULL external_id).
create index species_external_lookup_idx
  on public.species (user_id, external_source, external_id)
  where external_id is not null;
