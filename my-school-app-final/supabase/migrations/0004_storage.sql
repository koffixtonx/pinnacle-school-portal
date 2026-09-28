-- Storage buckets replacing the multer disk uploads under backend/uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('branding', 'branding', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('welcome-backgrounds', 'welcome-backgrounds', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may view branding; only school admins may add or replace objects.
create policy branding_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('branding', 'welcome-backgrounds'));

create policy branding_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id in ('branding', 'welcome-backgrounds') and public.is_admin());

create policy branding_admin_update on storage.objects
  for update to authenticated
  using (bucket_id in ('branding', 'welcome-backgrounds') and public.is_admin())
  with check (bucket_id in ('branding', 'welcome-backgrounds') and public.is_admin());

create policy branding_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('branding', 'welcome-backgrounds')
    and (
      public.is_super_admin()
      or (public.is_admin() and bucket_id = 'branding')
    )
  );
