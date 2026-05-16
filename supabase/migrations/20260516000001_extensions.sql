-- Postgres extensions used across the app.
-- postgis  → geospatial types (polygon, point) for garden boundaries and plant locations
-- pgcrypto → gen_random_uuid() for primary keys

create extension if not exists "postgis";
create extension if not exists "pgcrypto";
