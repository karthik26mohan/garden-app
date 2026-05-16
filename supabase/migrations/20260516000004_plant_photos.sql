-- One plant can have many photos over time (useful for a Day 9 growth-log stretch).
-- A plant can have at most one primary photo, enforced by the partial unique index.

create table public.plant_photos (
  id              uuid primary key default gen_random_uuid(),
  plant_id        uuid not null references public.plants(id) on delete cascade,
  storage_path    text not null,
  taken_at        timestamptz not null default now(),
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now()
);

create index plant_photos_plant_id_idx on public.plant_photos(plant_id);

create unique index plant_photos_one_primary_per_plant
  on public.plant_photos(plant_id) where is_primary;
