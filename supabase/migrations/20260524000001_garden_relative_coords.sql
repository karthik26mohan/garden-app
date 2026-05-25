-- Switch the gardens table from geographic (lat/lng, PostGIS) coordinates
-- to relative (feet from a yard-origin) coordinates. See DECISIONS.md
-- Entry #11 for the why.
--
-- Coordinate convention baked in here:
--   Origin    = top-left corner of yard
--   X axis    = increases rightward (east)
--   Y axis    = increases downward (south)
--   Unit      = feet
--
-- This matches SVG's coordinate convention so screen coords and stored
-- coords agree about which way is "down."
--
-- Zero-data-loss change: the boundary and centroid columns were never
-- written by any CRUD path in the app, so dropping them affects no data.
-- Existing rows get default position (0, 0) and size (10 x 20 ft); the
-- user can drag them where they belong using the editor.

-- The GIST index depends on the centroid column — drop it first.
drop index if exists public.gardens_centroid_gix;

-- Drop the PostGIS columns. `if exists` so this migration is idempotent
-- against any environment where the schema is already partly migrated.
alter table public.gardens drop column if exists boundary;
alter table public.gardens drop column if exists centroid;

-- Add the relative-coordinate columns. NOT NULL with defaults so existing
-- rows are auto-filled and the column contract is "always present" for
-- application code.
alter table public.gardens
  add column position_x_ft numeric not null default 0,
  add column position_y_ft numeric not null default 0,
  add column width_ft      numeric not null default 10,
  add column height_ft     numeric not null default 20;
