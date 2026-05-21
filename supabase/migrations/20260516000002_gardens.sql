-- A garden belongs to a user. Optional boundary polygon (the footprint of the
-- garden on the ground) and centroid point (a single "where" for the garden,
-- used for proximity queries later).

create table public.gardens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  description   text,
  boundary      geography(polygon, 4326),
  centroid      geography(point, 4326),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index gardens_user_id_idx on public.gardens(user_id);
create index gardens_centroid_gix on public.gardens using gist(centroid);

-- Auto-update updated_at on row changes
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger gardens_touch_updated_at
  before update on public.gardens
  for each row execute function public.touch_updated_at();
