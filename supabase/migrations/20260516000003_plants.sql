-- A plant lives in exactly one garden. Identification metadata comes from
-- Pl@ntNet (scientific_name, plantnet_score) and iNaturalist (inaturalist_taxon_id).
-- Location is optional — most users won't bother dropping pins.

create table public.plants (
  id                    uuid primary key default gen_random_uuid(),
  garden_id             uuid not null references public.gardens(id) on delete cascade,
  added_by_user_id      uuid not null references auth.users(id),

  common_name           text,
  scientific_name       text,
  inaturalist_taxon_id  integer,
  plantnet_score        numeric(5,4),

  location              geography(point, 4326),

  notes                 text,
  planted_at            date,
  identified_at         timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index plants_garden_id_idx on public.plants(garden_id);
create index plants_location_gix on public.plants using gist(location);

create trigger plants_touch_updated_at
  before update on public.plants
  for each row execute function public.touch_updated_at();
