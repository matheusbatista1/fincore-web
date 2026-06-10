import { defineConfig } from "drizzle-kit";

// Migrations use the direct (unpooled) connection; fall back to DATABASE_URL.
// Locally, set these in .env.local (printed by `supabase start`).
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  schema: "./src/infrastructure/db/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  // Cooperate with Supabase-managed roles (anon, authenticated, service_role) so
  // RLS policies generate/apply correctly via `drizzle-kit migrate`.
  entities: { roles: { provider: "supabase" } },
  strict: true,
  verbose: true,
});
