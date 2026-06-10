/** Credit card (cartão de crédito). */
export type CardFlag = "mastercard" | "visa" | "elo" | "amex" | "hipercard" | "other";

export interface CreditCard {
  readonly id: string;
  readonly bank: string;
  readonly product: string;
  readonly flag: CardFlag;
  readonly themeKey: string;
  readonly maskedNumber: string;
  readonly limitCents: number;
  /** Day of month the billing cycle closes (1–31). */
  readonly closingDay: number;
  /** Day of month the bill is due (1–31). */
  readonly dueDay: number;
}
