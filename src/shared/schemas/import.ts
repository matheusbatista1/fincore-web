import { z } from "zod";
import { centsSchema, idSchema, isoDateSchema } from "./common";
import { installmentParamsSchema } from "./transaction";

/** One reviewed statement line to import (sign decides expense vs income). */
export const importEntrySchema = z.object({
  date: isoDateSchema,
  description: z.string().trim().max(120).default(""),
  amountCents: centsSchema.refine((value) => value !== 0, "Valor não pode ser zero."),
  categoryId: idSchema.nullable().default(null),
  /** Mark this line as a recurring ("fixed") transaction. */
  fixed: z.boolean().default(false),
  /** Card-bill lines only: split this charge into an installment schedule. */
  installment: installmentParamsSchema.nullable().default(null),
});

/** Where the reviewed lines land: a wallet (bank statement) or a card (bill). */
const importTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("account"), accountId: idSchema }),
  z.object({ type: z.literal("card"), cardId: idSchema }),
]);

export const importStatementSchema = z.object({
  target: importTargetSchema,
  entries: z
    .array(importEntrySchema)
    .min(1, "Nenhum lançamento para importar.")
    .max(2000, "Importe no máximo 2000 lançamentos por vez."),
});
export type ImportStatementInput = z.infer<typeof importStatementSchema>;
