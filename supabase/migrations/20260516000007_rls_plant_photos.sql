-- Photos inherit access from plants, which inherit from gardens.
-- Three-hop predicate: user → garden → plant → photo.

alter table public.plant_photos enable row level security;

create policy "photos_select_via_plant"
  on public.plant_photos for select
  using (
    exists (
      select 1 from public.plants p
      join public.gardens g on g.id = p.garden_id
      where p.id = plant_photos.plant_id and g.user_id = auth.uid()
    )
  );

create policy "photos_insert_via_plant"
  on public.plant_photos for insert
  with check (
    exists (
      select 1 from public.plants p
      join public.gardens g on g.id = p.garden_id
      where p.id = plant_photos.plant_id and g.user_id = auth.uid()
    )
  );

create policy "photos_update_via_plant"
  on public.plant_photos for update
  using (
    exists (
      select 1 from public.plants p
      join public.gardens g on g.id = p.garden_id
      where p.id = plant_photos.plant_id and g.user_id = auth.uid()
    )
  );

create policy "photos_delete_via_plant"
  on public.plant_photos for delete
  using (
    exists (
      select 1 from public.plants p
      join public.gardens g on g.id = p.garden_id
      where p.id = plant_photos.plant_id and g.user_id = auth.uid()
    )
  );
