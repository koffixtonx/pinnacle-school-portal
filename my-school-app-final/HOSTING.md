# Hosting Guide

This document explains how to host the backend and frontend for the school app and how to configure the authentication database.

## Local development database

The backend uses Prisma with SQLite by default in development.

Steps:
1. Copy `backend/.env.example` to `backend/.env`.
2. Confirm `DATABASE_URL=file:./dev.db` is set in `backend/.env`.
3. From `my-school-app/backend`, run:
   ```bash
   npm install
   npm run db:setup
   ```
4. Start the backend:
   ```bash
   npm run dev
   ```
5. Start the frontend from `my-school-app`:
   ```bash
   npm install
   npm run dev
   ```

The `db:setup` step pushes the Prisma schema to SQLite and seeds initial authentication users.

## Production database

For production, do not use SQLite. Use a managed SQL database such as PostgreSQL or MySQL.

Set the `DATABASE_URL` environment variable in production. Example for PostgreSQL:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
```

If you use MySQL, the URL format looks like:

```env
DATABASE_URL=mysql://USER:PASSWORD@HOST:PORT/DATABASE
```

Then run any Prisma database setup step your deployment requires, for example:

```bash
npx prisma db push
```

or your provider's recommended migration workflow.

## Backend hosting

The backend can be hosted on any Node.js-capable platform. Recommended options include:
- Railway
- Render
- Fly.io
- Heroku
- A VPS or Docker-based service

Required production environment variables:
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `CLIENT_URL` (frontend application URL)
- `NODE_ENV=production`

Example backend startup on a hosting provider:

```bash
npm install --production
npm run build
npm start
```

## Frontend hosting

The frontend is a static Vite app and can be hosted on:
- Vercel
- Netlify
- Cloudflare Pages
- Any static hosting provider

Before building for production, set `VITE_API_BASE_URL` to your backend API URL.

Build and preview:

```bash
npm install
npm run build
npm run preview
```

## Additional notes

- Keep `JWT_SECRET` and `JWT_REFRESH_SECRET` secure. Do not commit them.
- In production, make sure `CLIENT_URL` matches the origin used by the frontend.
- If backend and frontend are deployed separately, update the frontend `VITE_API_BASE_URL` to the backend URL and configure CORS accordingly.
- `npm run db:setup` only works for local SQLite with the current project configuration. For production, set `DATABASE_URL` to your managed SQL database and use Prisma commands appropriate for your environment.
