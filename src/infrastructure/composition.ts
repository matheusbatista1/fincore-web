import { db } from "./db/client";
import { DrizzleFinanceRepository } from "./repositories/drizzle-finance-repository";

/**
 * Composition root: wires concrete adapters to the application ports. Server-only
 * (imports the DB client). Server Actions and RSC import the repository from here.
 */
export const financeRepository = new DrizzleFinanceRepository(db);
