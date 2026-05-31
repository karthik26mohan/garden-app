-- Switch the plants table from geographic (lat/lng, PostGIS) coordinates
-- to relative (feet from the parent garden's top-left corner) coordinates.
-- See DECISIONS.md Entry #12 for the why.
--
-- Coordinate convention:
--   Origin    = top-left corner of the parent garden
--   X axis    = increases rightward (east)
--   Y axis    = increases downward (south)
--   Unit      = feet
--   Diameter  = max width of the plant's canopy, also in feet
--
-- "Garden-relative" means moving the parent garden moves all its plants
-- automatically via SVG transform nesting — no per-plant updates needed
-- when a garden is dragged.
--
-- Zero-data-loss change: the location column was never populated by any
-- CRUD path in the app, so dropping it affects no data.

-- The GIST index depends on the location column — drop it first.
drop index if exists public.plants_location_gix;

-- Drop the PostGIS column.
alter table public.plants drop column if exists location;

-- Add the relative-coordinate columns. NOT NULL with defaults so existing
-- rows are auto-filled and the column contract is "always present" for
-- application code. Default diameter is 1 ft — about the size of a small
-- herb (basil, oregano); the user adjusts up for bigger plants.
alter table public.plants
  add column position_x_ft numeric not null default 0,
  add column position_y_ft numeric not null default 0,
  add column diameter_ft   numeric not null default 1;
