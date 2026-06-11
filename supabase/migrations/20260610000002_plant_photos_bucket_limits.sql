-- Server-side enforcement of what the client already does: photos are
-- resized to ≤1600px JPEG before upload, so anything bigger or non-JPEG
-- reaching the bucket is a bug or abuse. 5 MB is generous headroom.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = '{image/jpeg}'
where id = 'plant-photos';

-- Scope policies to authenticated explicitly; anon's auth.uid() is NULL
-- so this changes no outcomes, but it documents intent and skips
-- predicate evaluation for anonymous requests.
drop policy "plant_photos_storage_select_own" on storage.objects;
drop policy "plant_photos_storage_insert_own" on storage.objects;
drop policy "plant_photos_storage_delete_own" on storage.objects;

create policy "plant_photos_storage_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "plant_photos_storage_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "plant_photos_storage_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
