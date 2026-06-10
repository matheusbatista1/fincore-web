import { loadEnvFile } from "node:process";
import { defineConfig } from "drizzle-kit";

// Load .env.local for local CLI runs (migrate/studio). No-op if the file is absent
// (e.g. in CI, where env vars are provided directly). Uses Node 22's built-in loader.
try {
  loadEnvFile(".env.local");
} catch {
  // file not present — rely on the ambient environment
}

// Migrations use the direct (unpooled) connection; fall back to DATABASE_URL.
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
