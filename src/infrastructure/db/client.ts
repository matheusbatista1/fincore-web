import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/infrastructure/config/env";
import * as schema from "./schema";

// `prepare: false` is required for Supabase's transaction-mode pooler (port 6543).
// postgres-js connects lazily, so importing this module does not open a connection.
const queryClient = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(queryClient, { schema, casing: "snake_case" });

export type Database = typeof db;
export { schema };
