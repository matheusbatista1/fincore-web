import { z } from "zod";

/** An entity id (uuid from the DB / a select). Kept permissive — the DB validates the format. */
export const idSchema = z.string().min(1);

/** Money as an integer number of cents. */
export const centsSchema = z.number().int();

/** ISO calendar date `YYYY-MM-DD`. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Data inválida (use AAAA-MM-DD).");

/** Day of month for recurrence / billing (1–31). */
export const dayOfMonthSchema = z.number().int().min(1).max(31);
