# Pinnacle University School Portal

A school management portal built as a React single-page app on top of Supabase. There is no
application server: the browser talks to Postgres through PostgREST, authenticates through
Supabase Auth, and every permission rule is enforced by Row Level Security in the database.

## Features

### Data and access control
- **Supabase Postgres** with versioned migrations in `supabase/migrations/`
- **Row Level Security** on every table — tenancy and role checks live in the database, not in the UI
- **Supabase Auth** (email and password) with automatic token refresh; `auth.uid()` identifies the caller
- **Roles**: `SUPER_ADMIN`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`, `NON_ACADEMIC_STAFF`
- **Supabase Storage** for branding images and welcome-page backgrounds, with public read and admin-only write
- **Audit log** written by database triggers on every mutating request

### Modules
- Admin, teacher and student dashboards with charts fed by SQL analytics functions
- Students, teachers and departments management, plus CSV bulk import
- Courses, course catalogue, timetable and enrollment
- Attendance registers and grade books with automatic letter grades
- Fee invoices, payments and collection analytics
- Notifications with per-user read state
- Site customization: logo, hero image, theme colours, welcome message and rotating backgrounds
- Dark and light mode, responsive layout

### Frontend
- **React 19** with TypeScript and Vite
- **Material-UI (MUI)** for the component system
- **React Router** for navigation
- **Recharts** for dashboard charts

## Project Structure

```
my-school-app-final/
├── supabase/
│   ├── migrations/            # Applied in filename order
│   │   ├── 0001_schema.sql    # Tables, keys, check constraints
│   │   ├── 0002_functions.sql # Triggers, tenant helpers, RPCs, analytics
│   │   ├── 0003_rls.sql       # ALTER ... ENABLE ROW LEVEL SECURITY + policies
│   │   ├── 0004_storage.sql   # buckets and storage policies
│   │   └── 0005_seed.sql      # tenant row and default site settings
│   └── tests/local/           # Supabase shim + RLS assertions (never deployed)
├── src/
│   ├── pages/                 # One component per route
│   ├── components/            # DrawerAppBar and shared UI
│   ├── hooks/useCurrentUser.ts
│   ├── services/
│   │   ├── api.ts             # Supabase client, error and row-shape helpers
│   │   └── api.service.ts     # The typed data layer every page calls
│   ├── theme/                 # MUI theme factory
│   ├── App.tsx                # Routes and protected routes
│   └── main.tsx
├── .env.example               # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
└── HOSTING.md                 # Deployment and pre-launch checklist
```

The retired server lives in `../legacy-express-backend/`, a sibling of this folder.

## Prerequisites

- Node.js v20 or newer
- A Supabase project (the free tier is enough)

## Setup

### 1. Create the database

In the Supabase dashboard, open **SQL Editor** and run the files in `supabase/migrations/` in
filename order — `0001` through `0005`. Do not skip `0002` before `0003`: the RLS policies call
the helper functions the previous file defines.

With the Supabase CLI the same thing is one command:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

`0005_seed.sql` inserts the `pinnacle-school` tenant and its default site settings, which the
auth triggers require. It does not create any account.

### 2. Install and configure the client

```bash
npm install
cp .env.example .env.local
```

Fill `.env.local` with the values from **Project Settings → API Keys**:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_…
```

Both values ship inside the browser bundle and are public by design — the publishable key (or a
legacy `anon public` JWT, which also fits in that variable) only grants whatever Row Level Security
allows. Never put a `sb_secret_…` / `service_role` key or the database password in this project;
anything prefixed `VITE_` is readable by anyone who loads the site.

### 3. Create the first administrator

Run the dev server, register through `/register`, then promote your own row in the SQL editor:

```sql
update public.profiles set role = 'SUPER_ADMIN' where email = 'you@example.com';
```

Public registration can only ever produce a `STUDENT` — `handle_new_auth_user()` ignores any role
sent from the client, because the sign-up payload is attacker-controlled. Every other account is
created from the admin UI, which calls the admin-only `create_school_user()` function.

### 4. Start developing

```bash
npm run dev      # http://localhost:5173
npm run build    # type-check then produce dist/
npm run preview  # serve the production build locally
npm run lint     # ESLint
```

## How the data layer works

Pages never import the Supabase client. They call the services in `src/services/api.service.ts`,
which keep the shape the pages were written against:

```ts
const response = await academicsService.listCourses();
const courses = response.data.data;   // camelCase rows
```

`src/services/api.ts` provides the shared pieces:

- `supabase` — the one client instance, created from the two environment variables
- `ServiceError` — thrown with a `response.data.message` field so existing `catch` blocks work
- `unwrap()` — turns a `{ data, error }` result into a value or a `ServiceError`
- `camel()` — maps `snake_case` columns onto the `camelCase` names the pages use
- `resolveAssetUrl()` — turns a stored `bucket/object` path into a public Storage URL

### Validation

The checks the Express controllers used to run are performed in `api.service.ts` before a request
is sent: email shape, the Nigerian phone format, password length, attendance and payment
enumerations, timetable day and hour ranges, the 160-character welcome message limit.

Database constraints are the authority. Column `CHECK`s, foreign keys and unique indexes reject
anything that slips past the client, and `0003_rls.sql` refuses writes that try to cross a
role or tenant boundary — for example a teacher editing another teacher's grade entry, or anyone
changing their own role.

### Storage

Two buckets, both created by `0004_storage.sql`:

| Bucket | Contents | Written by |
| --- | --- | --- |
| `branding` | logo and hero image | administrators |
| `welcome-backgrounds` | rotating welcome images, up to eight | administrators |

Rows store the `bucket/object` path, and `resolveAssetUrl()` builds the public URL at render time.

## Roles and permissions

| Capability | SUPER_ADMIN | SCHOOL_ADMIN | TEACHER | STUDENT |
| --- | --- | --- | --- | --- |
| Dashboards | admin | admin | teacher | student |
| Students directory | yes | yes | own classes | own record |
| Teachers and departments | yes | yes | read | — |
| Courses and timetable | yes | yes | read | read |
| Attendance | record | record | record | view own |
| Grades | record | record | record | view own |
| Fees and invoices | yes | yes | — | view own |
| Site customization | yes | yes | — | — |
| Audit log | yes | yes | — | — |

Only a `SUPER_ADMIN` may change roles, delete a tenant's branding, or edit another
administrator's profile.

## Deployment

The app is a static bundle; Supabase hosts the database, auth and storage.

1. Build and publish `dist/` to Vercel, Netlify, Cloudflare Pages or any static host.
   `vercel.json` already rewrites unknown paths to `index.html` for client-side routing.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as the host's build-time environment
   variables — Vite inlines them, so a change requires a rebuild.
3. In **Supabase → Authentication → URL Configuration**, add the production URL to the Site URL
   and Redirect URLs list.
4. Keep migrations in the repository: apply `supabase/migrations/` from a tagged release rather
   than editing the schema in the dashboard, so production and the code stay in step.

`legacy-express-backend/render.yaml` is the deployment blueprint for the retired server; it is not
used by this app.

## Troubleshooting

**`VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set`**
`.env.local` is missing or empty. Vite only reads `.env*` files at the project root, and only
variables prefixed `VITE_` reach the browser.

**`The database schema has not been migrated yet`**
`0001_schema.sql` has not been applied. Run the migrations in order.

**Sign-in works but every list is empty**
The tenant row is missing, so `handle_new_auth_user()` could not attach your profile. Apply
`0005_seed.sql`, then register again.

**A write fails with a policy violation you did not expect**
Read the matching policy in `0003_rls.sql`. RLS denies by default, and the guard triggers in the
same file reject role, tenant and ownership changes that the API surface would otherwise allow.

**Uploads store a path but nothing renders**
The bucket must exist (`0004_storage.sql`) and the stored value must be `bucket/object`. Values
beginning with `/uploads/` came from the retired Express server and no longer resolve;
`resolveAssetUrl()` returns an empty string for them.

## Security notes

- [x] Row Level Security on every table, denial by default
- [x] Tenant id derived from the JWT, never accepted from the client
- [x] Public sign-up cannot mint privileged roles
- [x] Secrets limited to the two public client values; no service key in the bundle
- [x] Images confined to two admin-written buckets
- [x] Audit trail written by triggers
- [ ] (Recommended) Enable Supabase's built-in auth rate limits and CAPTCHA for sign-in
- [ ] (Recommended) Turn on Point-in-Time Recovery for the database
