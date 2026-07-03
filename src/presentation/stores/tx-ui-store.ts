import { create } from "zustand";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";

/**
 * Cross-screen transaction modal state (detail → edit / delete-scope, plus the
 * installment-group list). Rows on any screen call the openers; the modals
 * themselves are mounted once in the app layout (TxModalsHost).
 */
interface TxUIState {
  readonly detail: TransactionListItem | null;
  readonly editing: TransactionListItem | null;
  readonly deleting: TransactionListItem | null;
  /** When set, the Pay modal settles this deferred obligation (boleto/loan/financing). */
  readonly paying: TransactionListItem | null;
  /** When set, the Receive modal records receipt of this normal income (mirror of `paying`). */
  readonly receiving: TransactionListItem | null;
  /** When set, the installment-group modal lists every parcela of this group. */
  readonly installmentGroupId: string | null;
  openDetail: (item: TransactionListItem) => void;
  openEdit: (item: TransactionListItem) => void;
  openDelete: (item: TransactionListItem) => void;
  openPay: (item: TransactionListItem) => void;
  openReceive: (item: TransactionListItem) => void;
  openInstallmentGroup: (groupId: string) => void;
  closeDetail: () => void;
  closeEdit: () => void;
  closeDelete: () => void;
  closePay: () => void;
  closeReceive: () => void;
  closeInstallmentGroup: () => void;
}

const CLOSED = {
  detail: null,
  editing: null,
  deleting: null,
  paying: null,
  receiving: null,
  installmentGroupId: null,
} as const;

export const useTxUIStore = create<TxUIState>((set) => ({
  detail: null,
  editing: null,
  deleting: null,
  paying: null,
  receiving: null,
  installmentGroupId: null,
  openDetail: (item) => set({ ...CLOSED, detail: item }),
  openEdit: (item) => set({ ...CLOSED, editing: item }),
  openDelete: (item) => set({ ...CLOSED, deleting: item }),
  openPay: (item) => set({ ...CLOSED, paying: item }),
  openReceive: (item) => set({ ...CLOSED, receiving: item }),
  openInstallmentGroup: (groupId) => set({ ...CLOSED, installmentGroupId: groupId }),
  closeDetail: () => set({ detail: null }),
  closeEdit: () => set({ editing: null }),
  closeDelete: () => set({ deleting: null }),
  closePay: () => set({ paying: null }),
  closeReceive: () => set({ receiving: null }),
  closeInstallmentGroup: () => set({ installmentGroupId: null }),
}));

/** Imperative helper for row components. */
export const openTxDetail = (item: TransactionListItem): void => useTxUIStore.getState().openDetail(item);

/** Imperative helper to open the Pay modal for a deferred obligation (boleto/loan/financing). */
export const openPayObligation = (item: TransactionListItem): void => useTxUIStore.getState().openPay(item);

/** Imperative helper to open the Receive modal for a normal income (a pending receivable). */
export const openReceiveIncome = (item: TransactionListItem): void =>
  useTxUIStore.getState().openReceive(item);

/** Imperative helper to open the installment-group list from a collapsed row. */
export const openInstallmentGroup = (groupId: string): void =>
  useTxUIStore.getState().openInstallmentGroup(groupId);
