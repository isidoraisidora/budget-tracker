# Pocket Budget

A personal budget tracker built with Next.js. Track cash and credit-card balances, record spending and top-ups, and save toward goals.

## Run locally

Requires Node.js 20 or later.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `npm run lint` and `npm run build` to check the project.

## Supabase setup

The app uses Supabase Auth and a Postgres database. In your Supabase project, open **SQL Editor**, run [`supabase/schema.sql`](./supabase/schema.sql), then copy `.env.example` to `.env.local` and fill in the project URL and publishable key from **Project Settings → API** (the legacy anon key is also supported). Restart `npm run dev` after changing environment variables.

Add the same two `NEXT_PUBLIC_` variables to your hosting provider's environment settings before deploying. These are browser-visible values; never use a Supabase `service_role` or secret key in this app. Row-level security in the schema limits each signed-in user to their own budget data.

Existing browser-only accounts and budget data are not imported automatically; the new sign-in uses Supabase Auth with an email address.

