-- Plants don't carry user_id directly — they inherit access from their parent garden.
-- These policies check "does the current user own the garden this plant is in?"

alter table public.plants enable row level security;

create policy "plants_select_via_garden"
  on public.plants for select
  using (
    exists (
      select 1 from public.gardens g
      where g.id = plants.garden_id and g.user_id = auth.uid()
    )
  );

create policy "plants_insert_via_garden"
  on public.plants for insert
  with check (
    exists (
      select 1 from public.gardens g
      where g.id = plants.garden_id and g.user_id = auth.uid()
    )
  );

create policy "plants_update_via_garden"
  on public.plants for update
  using (
    exists (
      select 1 from public.gardens g
      where g.id = plants.garden_id and g.user_id = auth.uid()
    )
  );

create policy "plants_delete_via_garden"
  on public.plants for delete
  using (
    exists (
      select 1 from public.gardens g
      where g.id = plants.garden_id and g.user_id = auth.uid()
    )
  );
