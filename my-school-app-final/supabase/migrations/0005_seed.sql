-- Baseline tenant row. Accounts live in auth.users, which this migration must
-- not touch: register in the app first, then promote with the statement at the
-- bottom of this file.

insert into public.tenants (name, slug, status)
values ('Pinnacle School', 'pinnacle-school', 'ACTIVE')
on conflict (slug) do nothing;

insert into public.site_settings (tenant_id, primary_color, secondary_color, welcome_message_color)
select id, '#1976D2', '#E91E63', '#FFFFFF'
  from public.tenants
 where slug = 'pinnacle-school'
on conflict (tenant_id) do nothing;

-- Bootstrap the first administrator. Public sign-up can only ever create a
-- STUDENT (see handle_new_auth_user), so the first admin is promoted here
-- instead of being handed out by the registration form.
--
--   update public.profiles
--      set role = 'SUPER_ADMIN'
--    where email = 'you@example.com';
