# `infrastructure` — Adapters & I/O

Implements `application/ports` against real technology. May import `domain` and
`application`. **Never imported by `domain` or `application`.**

Contents:

- `db/` — Drizzle schema, client, repositories, SQL views, seed script.
- `auth/` — Supabase Auth (SSR cookies) helpers.
- `config/` — validated environment (`env.ts` via `@t3-oss/env-nextjs` + Zod).

Rules:

- Money columns are `bigint` **cents**. Per-user isolation is enforced by
  Postgres RLS (`auth.uid()`), not only by app-layer scoping.
- The Supabase `service_role` key is used only in trusted server-side jobs
  (seed, migrations) — never shipped to the client.
