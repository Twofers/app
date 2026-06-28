-- Dev-only setup helper for the AI Deal Studio private asset bucket.
-- Run only after the Supabase CLI is linked to the separate dev project.
-- Keep this file out of supabase/migrations until the feature schema is approved.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ai-deal-assets',
  'ai-deal-assets',
  false,
  52428800,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Owners can read own AI deal assets" on storage.objects;
create policy "Owners can read own AI deal assets"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'ai-deal-assets'
  and exists (
    select 1
    from public.businesses b
    where b.owner_id = auth.uid()
      and b.id::text = split_part(storage.objects.name, '/', 1)
  )
);

drop policy if exists "Owners can upload own AI deal assets" on storage.objects;
create policy "Owners can upload own AI deal assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'ai-deal-assets'
  and exists (
    select 1
    from public.businesses b
    where b.owner_id = auth.uid()
      and b.id::text = split_part(storage.objects.name, '/', 1)
  )
);

drop policy if exists "Owners can update own AI deal assets" on storage.objects;
create policy "Owners can update own AI deal assets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'ai-deal-assets'
  and exists (
    select 1
    from public.businesses b
    where b.owner_id = auth.uid()
      and b.id::text = split_part(storage.objects.name, '/', 1)
  )
)
with check (
  bucket_id = 'ai-deal-assets'
  and exists (
    select 1
    from public.businesses b
    where b.owner_id = auth.uid()
      and b.id::text = split_part(storage.objects.name, '/', 1)
  )
);

drop policy if exists "Owners can delete own AI deal assets" on storage.objects;
create policy "Owners can delete own AI deal assets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'ai-deal-assets'
  and exists (
    select 1
    from public.businesses b
    where b.owner_id = auth.uid()
      and b.id::text = split_part(storage.objects.name, '/', 1)
  )
);
