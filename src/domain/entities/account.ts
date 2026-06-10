/** Bank account / wallet (conta bancária / carteira). */
export type AccountType = "PF" | "PJ";

export interface Account {
  readonly id: string;
  readonly bank: string;
  readonly name: string;
  readonly type: AccountType;
  /** Bank theme key for the card/wallet gradient (see shared/theme/bank-themes). */
  readonly themeKey: string;
  /** Opening balance in cents. The live balance is DERIVED (see balance calculator). */
  readonly openingBalanceCents: number;
  /** Masked account number, e.g. "•• 4821". */
  readonly maskedNumber: string;
}
