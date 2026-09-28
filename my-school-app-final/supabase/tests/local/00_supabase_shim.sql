-- ---------------------------------------------------------------------------
-- Local Supabase shim - NOT part of a deployment.
--
-- Recreates just enough of the Supabase platform (auth schema, storage schema,
-- the `anon` / `authenticated` roles and the request.jwt.claims GUC) to run the
-- real migrations in supabase/migrations/ against a plain Postgres server, so
-- the schema, functions and RLS policies can be tested without a cloud project.
--
-- See supabase/tests/local/README.md for how to run it.
-- ---------------------------------------------------------------------------

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

-- Supabase's PostgREST/GoTrue roles. `supabase_auth_admin` owns the auth schema
-- in the hosted product; here the migrations run as the superuser and we only
-- need the two roles that policies and grants name.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- GoTrue's user table. Columns are the subset the migrations touch; the types
-- and defaults match the hosted schema.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  aud                text,
  role               text,
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  confirmation_token         text,
  recovery_token             text,
  email_change               text,
  email_change_token_new     text,
  email_change_token_current text,
  phone              text,
  phone_change       text,
  phone_change_token text,
  is_sso_user        boolean not null default false,
  deleted_at         timestamptz
);

-- identity_data drives the STORED generated `email` column exactly as it does in
-- GoTrue, which is what makes writing to that column an error.
create table if not exists auth.identities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  provider_id     text,
  provider        text,
  identity_data   jsonb not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  email           text generated always as (lower(identity_data ->> 'email')) stored,
  status          text,
  unique (provider, provider_id)
);

-- Storage API tables. path_tokens mirrors how the hosted product exposes an
-- object's key for policy checks.
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id            uuid primary key default gen_random_uuid(),
  bucket_id     text references storage.buckets (id) on delete cascade,
  name          text,
  owner         uuid,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata      jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored
);

alter table storage.objects enable row level security;
grant usage on schema auth, storage, extensions to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select, insert, update, delete on storage.buckets to anon, authenticated;

-- PostgREST puts the verified JWT claims into this GUC for every request. An
-- empty string means "no JWT", which is what a direct SQL-editor / service-role
-- path looks like - the distinction several guards rely on.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', 'anon');
$$;
