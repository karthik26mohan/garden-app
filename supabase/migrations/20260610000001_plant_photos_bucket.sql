-- Private Storage bucket for plant photos, per the photo-identification
-- spec (docs/superpowers/specs/2026-06-10-photo-plant-identification-design.md).
--
-- Path convention: {user_id}/{plant_id}/{uuid}.jpg
-- Policies key off the FIRST path segment matching auth.uid(), so a user
-- can only touch objects under their own folder. The plant_photos table
-- (migration 20260516000004) stores the path; signed URLs are issued at
-- read time by the app.

insert into storage.buckets (id, name, public)
values ('plant-photos', 'plant-photos', false)
on conflict (id) do nothing;

create policy "plant_photos_storage_select_own"
  on storage.objects for select
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "plant_photos_storage_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "plant_photos_storage_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No update policy: photos are immutable — replace = delete + insert.
