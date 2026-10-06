# Hosting Guide

This app has no application server to host. The frontend is a static bundle, and Supabase hosts
the database, authentication and file storage behind it. Your only deployment targets are the
static host and the Supabase project.

## What runs where

| Concern | Hosted by |
| --- | --- |
| React bundle (`dist/`) | Vercel, Netlify, Cloudflare Pages, any static host |
| Tables, views, triggers, RLS policies | Supabase Postgres |
| Sign-up, sign-in, token refresh | Supabase Auth (GoTrue) |
| Logo, hero image, welcome backgrounds | Supabase Storage (`branding`, `welcome-backgrounds`) |
| Audit log | Database triggers writing to `public.audit_logs` |

There is nothing to scale on the compute side beyond the browser, and no `JWT_SECRET` to
generate — Supabase signs and rotates its own tokens.

## Local development

1. Apply the migrations to a **development** Supabase project (see below). Do not point local
   development at production data.
2. `npm install`
3. `cp .env.example .env.local` and fill in the project URL and the publishable key from
   **Project Settings → API Keys**. Projects still on the older scheme use the `anon public`
   JWT instead; both go in the same variable.
4. `npm run dev` → http://localhost:5173

`.env.local` is gitignored. Vite reads `.env*` files only from the project root and only
forwards variables prefixed `VITE_`.

## Applying migrations

Either run each file in `supabase/migrations/` in filename order in the dashboard's SQL Editor,
or use the CLI:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Order matters: `0003_rls.sql` policies call the helper functions defined in `0002_functions.sql`,
and `0002`'s auth trigger needs the tenant row inserted by `0005_seed.sql`.

Verify an environment by checking the first table is actually populated:

```sql
select count(*) from public.tenants;   -- 0 means 0005_seed.sql has not been applied
```

Before pushing to a project, the same files can be run against a throwaway Postgres with the
persona assertions in `supabase/tests/local/` - see that folder's README. It reproduces the `auth`
and `storage` schemas and the `request.jwt.claims` PostgREST sets, so RLS and the guard triggers are
actually exercised rather than assumed.

## Environment variables

Only two, both public:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_…      # or a legacy anon JWT, starting "eyJ"
```

A publishable or anon key is safe to ship in the browser bundle because it only ever grants what
Row Level Security allows. The `sb_secret_…` / `service_role` key and the database password must
never appear in this repository or in a host's `VITE_` variables — anything inlined at build time
is readable by anyone who loads the page, and a secret key bypasses RLS entirely. `src/services/supabase-config.ts`
rejects a secret key in `VITE_SUPABASE_ANON_KEY` at start-up so this cannot happen silently. Use a
secret key only in a server-side context you control (the Supabase CLI, a scheduled job), never
from the client.

Vite inlines these values when it builds, so changing a project URL or key requires a new
deployment, not a restart.

## Frontend hosting

`npm run build` type-checks and emits `dist/`. Configure the host for SPA routing so a refresh on
`/students` does not 404:

- **Vercel** — `vercel.json` in the repository already sets `outputDirectory: dist` and rewrites
  `/(.*)` to `/index.html`. Push the repo, import the project, add the two environment variables.
- **Netlify** — build command `npm run build`, publish directory `dist`, plus a redirect:
  ```
  /*  /index.html  200
  ```
- **Cloudflare Pages** — build command `npm run build`, build output directory `dist`; SPA
  fallback is automatic, or add a `public/_redirects` file with `/* /index.html 200`.
- **Any other host** — serve `dist/` with a fallback to `index.html`.

Set the two `VITE_` variables in the host's environment UI so they are inlined at build time.
They are not secrets, so committing them to a public repo would technically work — keep them in
the host's settings anyway, so a project rotation is a one-line change.

## Supabase configuration

- **Authentication → URL Configuration**: add the production origin to *Site URL* and to
  *Redirect URLs*, and add `http://localhost:5173` for development.
- **Authentication → Providers**: only Email is required by this app. If "Confirm email" is on,
  new accounts created via `create_school_user()` cannot sign in until they confirm, and the
  initial-password flow in the admin UI will look broken — turn confirmation off or send the
  confirmation link.
- **Storage**: `0004_storage.sql` creates both buckets as public-read, admin-write. If you prefer
  signed URLs, change the buckets to private and swap `resolveAssetUrl()` in
  `src/services/api.ts` for `storage.createSignedUrl()`.
- **API settings**: leave PostgREST enabled — the entire data layer depends on it. If you disable
  it, every page fails.

## First administrator

Migrations create no accounts, and public sign-up can only ever produce a `STUDENT`. Register
once through `/register`, then promote your own row in the SQL editor:

```sql
update public.profiles set role = 'SUPER_ADMIN' where email = 'you@example.com';
```

Every subsequent account is created from the admin UI, which calls the admin-only
`create_school_user()` function.

## Multiple schools from one deployment

Tenancy is a column, not a database. Add a row to `public.tenants` per school; the auth trigger
attaches each new profile to a tenant, and every RLS policy filters on it. Running one project per
school instead is also valid and gives you isolation at the cost of N migrations to maintain.

Two policies read across tenants by design, because the signed-out landing page has no tenant
context to filter with: `tenants_read` (any ACTIVE school) and `site_settings_read_public`
(`using (true)`). In a shared project every school's name, logo path, theme colours and welcome
message are therefore publicly readable by anyone holding the publishable key. Nothing else is, and no
write policy is unscoped - but if that exposure matters, give each school its own project.

## Pre-launch checklist

- [ ] Migrations `0001`–`0005` applied to the production project, from a tagged release rather
      than ad-hoc edits in the dashboard
- [ ] Production origin added to Site URL and Redirect URLs
- [ ] `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set in the host; `service_role` key and DB
      password set nowhere in the frontend
- [ ] SPA fallback verified: reload a deep route such as `/settings`
- [ ] Admin upload of a logo and a welcome background renders from Storage
- [ ] A `STUDENT` token cannot read another student's row — try it in the SQL editor or via the
      REST API, do not trust the UI alone
- [ ] Point-in-Time Recovery enabled (**Database → Backups**)
- [ ] Sign-in rate limiting / CAPTCHA enabled (**Authentication → Rate limits**)

## Retired Express backend

`../legacy-express-backend/` holds the old Node/Express/Prisma server, kept for reference only.
It is not built, deployed, or imported by this app; its `render.yaml`, `JWT_SECRET`,
`DATABASE_URL`/SQLite and `VITE_API_BASE_URL` configuration are all obsolete. Delete the folder
once the Supabase build has been verified in production. Uploads made under that server
(`backend/uploads/*`) are not reachable any more — re-upload branding images and backgrounds so
they land in Storage, and note that `resolveAssetUrl()` intentionally returns an empty string for
legacy `/uploads/...` paths.
