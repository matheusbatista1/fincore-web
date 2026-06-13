import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Validated, type-safe environment access. Importing this module fails fast at
 * startup if a required variable is missing or malformed. Only NEXT_PUBLIC_* vars
 * reach the browser; everything else is server-only.
 *
 * In CI the build runs with SKIP_ENV_VALIDATION=1 so it doesn't need real secrets.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Pooled Postgres connection (port 6543) used at runtime. */
    DATABASE_URL: z.string().min(1),
    /** Direct/session Postgres connection (port 5432) used for migrations. */
    DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
    /** Supabase service-role key — server-only, bypasses RLS (seed/admin jobs). */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    /** Shared secret for the daily account-purge cron. Optional: the cron is disabled until set. */
    CRON_SECRET: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_APP_URL: z.string().min(1),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
