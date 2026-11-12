import { z } from "zod";
import { centsSchema, competenceMonthSchema, idSchema, isoDateSchema } from "./common";

/** One line of the statement being checked, as the parser read it. */
const reconcileLineSchema = z.object({
  date: isoDateSchema,
  description: z.string().trim().max(200).default(""),
  amountCents: centsSchema.refine((value) => value !== 0, "Valor não pode ser zero."),
});

/** What the statement is of: an account, or a card's fatura. */
const reconcileTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("account"), accountId: idSchema }),
  z.object({
    type: z.literal("card"),
    cardId: idSchema,
    /** The fatura, by its due month. `null`: find the one the file belongs to. */
    month: competenceMonthSchema.nullable().default(null),
  }),
]);

export const reconcileStatementSchema = z.object({
  target: reconcileTargetSchema,
  lines: z
    .array(reconcileLineSchema)
    .min(1, "Nenhuma linha para conferir.")
    .max(2000, "Confira no máximo 2000 linhas por vez."),
});
export type ReconcileStatementInput = z.infer<typeof reconcileStatementSchema>;
