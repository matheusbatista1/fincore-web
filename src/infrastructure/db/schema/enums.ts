import { pgEnum } from "drizzle-orm/pg-core";

export const accountType = pgEnum("account_type", ["PF", "PJ"]);

export const cardFlag = pgEnum("card_flag", ["mastercard", "visa", "elo", "amex", "hipercard", "other"]);

export const transactionKind = pgEnum("transaction_kind", ["expense", "income", "transfer"]);

export const expenseSource = pgEnum("expense_source", [
  "card",
  "account",
  "boleto",
  "loan",
  "financing",
  "overdraft",
]);

export const parcelaStatus = pgEnum("parcela_status", ["paga", "atual", "futura"]);
