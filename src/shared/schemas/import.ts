import { z } from "zod";
import { centsSchema, idSchema, isoDateSchema } from "./common";

/** One reviewed statement line to import (sign decides expense vs income). */
export const importEntrySchema = z.object({
  date: isoDateSchema,
  description: z.string().trim().max(120).default(""),
  amountCents: centsSchema.refine((value) => value !== 0, "Valor não pode ser zero."),
  categoryId: idSchema.nullable().default(null),
});

export const importStatementSchema = z.object({
  accountId: idSchema,
  entries: z
    .array(importEntrySchema)
    .min(1, "Nenhum lançamento para importar.")
    .max(2000, "Importe no máximo 2000 lançamentos por vez."),
});
export type ImportStatementInput = z.infer<typeof importStatementSchema>;
