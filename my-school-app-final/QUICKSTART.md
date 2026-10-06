# Quick Start — Pinnacle University School Portal

The app is a React SPA with no server of its own: Supabase provides Postgres (with Row Level
Security), Auth and Storage.

## ⚡ Setup

### 1. Apply the schema

Supabase dashboard → SQL Editor → run `supabase/migrations/0001_schema.sql` through
`0005_seed.sql` **in order**, or:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### 2. Configure the client

```bash
npm install
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_…
```

Both come from **Project Settings → API Keys**. They are safe to expose: RLS decides what the
publishable key can reach. Older projects show an `anon public` JWT in the same place — either
shape works. Never put a `sb_secret_…` / `service_role` key in this project.

### 3. Run it

```bash
npm run dev      # http://localhost:5173
```

### 4. Create an administrator

Register at `/register` — self-registration always produces a `STUDENT` — then promote your row in
the SQL editor:

```sql
update public.profiles set role = 'SUPER_ADMIN' where email = 'you@example.com';
```

Sign out and back in so the new role reaches the client. Everyone else is created from the admin
UI (Students, Teachers pages), which provisions accounts through `create_school_user()`.

## 🧭 First session

1. **Dashboard** (`/dashboard`) — enrollment, collections and attendance charts, recent audit
   activity, CSV student import.
2. **Site Customization** (`/site-customization`) — logo, hero image, theme colours, welcome
   message and up to eight rotating welcome backgrounds. Uploads go to Supabase Storage.
3. **Departments → Courses → Timetable** — build the academic structure before recording
   attendance or grades.
4. **Students / Teachers** — create accounts. New accounts sign in with the initial password that
   `create_school_user()` assigns (`ChangeMe123!`); each person replaces it under
   **Settings → Change Password**.
5. **Attendance / Grades / Fees** — operational modules, each with role-scoped reads.

## 🛠️ Commands

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b then vite build
npm run preview    # serve dist/
npm run lint       # ESLint
sh supabase/tests/local/apply.sh   # RLS / trigger assertions on a local Postgres
```

There is no `db:setup` any more — schema changes are new files in `supabase/migrations/`, and the
assertions in `supabase/tests/local/` run them against a throwaway database. Add a check there
whenever you add a policy.

## 🔐 Security checklist

- [x] RLS enabled on every table, denial by default
- [x] `tenant_id` derived from the JWT and defaulted by the database
- [x] Client-supplied roles rejected by `handle_new_auth_user()`
- [x] Guard triggers on profiles, enrollments, attendance, grades and site settings
- [x] Audit trail written by triggers, not by application code
- [x] Storage buckets writable by administrators only
- [ ] Enable email confirmation / MFA in Supabase Auth before real users sign up
- [ ] HTTPS everywhere (Supabase enforces TLS on its endpoints)

## 🐛 Troubleshooting

**"Check the Supabase configuration" replaces the app**
`.env.local` is missing, or a value is malformed — most often an anon key that lost its
signature when it was selected instead of copied. The screen names the broken value. Vite
inlines both variables at start-up, so an edit made after `npm run dev` began needs a restart.

In development the console also logs `[supabase] <host> is unreachable` when the project host
does not resolve, which means that project ref does not exist on Supabase.

**`permission` / `row-level-security` errors in the console**
A migration was skipped. `0003_rls.sql` must run after `0002_functions.sql`.

**Sign-in succeeds, data is empty**
No tenant row: apply `0005_seed.sql`, register again so the trigger can attach your profile.

**Images upload but do not display**
Run `0004_storage.sql` to create the buckets. Paths beginning with `/uploads/` are legacy
Express-era values and no longer resolve.

**`Invalid login credentials` for a user created in the dashboard**
Accounts created by `create_school_user()` get a generated password; use the one shown in the UI,
or reset it from Supabase → Authentication → Users.

## 📚 More

- `README.md` — architecture, data layer conventions, role matrix, deployment
- `HOSTING.md` — static hosting and Supabase settings
- `../legacy-express-backend/` — the retired Node/Express/Prisma server, for reference only
