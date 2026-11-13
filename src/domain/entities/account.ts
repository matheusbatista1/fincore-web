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
  /**
   * Money set aside (reserva, investimento): it is part of the net worth, but not of what is
   * available to spend — so it stays out of the available balance and of the "fim do mês".
   */
  readonly isReserve: boolean;
}

/** The accounts whose money is available to spend: every one not set aside as a reserve. */
export function spendingAccounts<T extends Pick<Account, "isReserve">>(accounts: readonly T[]): T[] {
  return accounts.filter((account) => !account.isReserve);
}
