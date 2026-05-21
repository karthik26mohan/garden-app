-- Row Level Security on gardens. A user can read/write only their own rows.
-- The database — not the application — enforces this.

alter table public.gardens enable row level security;

create policy "gardens_select_own"
  on public.gardens for select
  using (auth.uid() = user_id);

create policy "gardens_insert_own"
  on public.gardens for insert
  with check (auth.uid() = user_id);

create policy "gardens_update_own"
  on public.gardens for update
  using (auth.uid() = user_id);

create policy "gardens_delete_own"
  on public.gardens for delete
  using (auth.uid() = user_id);
