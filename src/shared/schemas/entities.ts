import { z } from "zod";
import { centsSchema, dayOfMonthSchema } from "./common";

export const accountInputSchema = z.object({
  bank: z.string().trim().min(1, "Informe o banco.").max(60),
  name: z.string().trim().min(1, "Informe um nome.").max(60),
  type: z.enum(["PF", "PJ"]),
  themeKey: z.string().max(40).default(""),
  openingBalanceCents: centsSchema.default(0),
  maskedNumber: z.string().max(24).default(""),
});
export type AccountInput = z.infer<typeof accountInputSchema>;

export const creditCardInputSchema = z.object({
  bank: z.string().trim().min(1, "Informe o banco.").max(60),
  product: z.string().trim().min(1, "Informe o produto.").max(60),
  flag: z.enum(["mastercard", "visa", "elo", "amex", "hipercard", "other"]),
  themeKey: z.string().max(40).default(""),
  maskedNumber: z.string().max(24).default(""),
  limitCents: centsSchema.nonnegative("Limite não pode ser negativo.").default(0),
  closingDay: dayOfMonthSchema,
  dueDay: dayOfMonthSchema,
});
export type CreditCardInput = z.infer<typeof creditCardInputSchema>;

export const personInputSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome.").max(80),
  relationship: z.string().max(40).default(""),
  color: z.string().max(24).default(""),
});
export type PersonInput = z.infer<typeof personInputSchema>;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome.").max(60),
  color: z.string().max(24).default(""),
  icon: z.string().max(40).default(""),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;
