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
  /** When set, the installment-group modal lists every parcela of this group. */
  readonly installmentGroupId: string | null;
  openDetail: (item: TransactionListItem) => void;
  openEdit: (item: TransactionListItem) => void;
  openDelete: (item: TransactionListItem) => void;
  openInstallmentGroup: (groupId: string) => void;
  closeDetail: () => void;
  closeEdit: () => void;
  closeDelete: () => void;
  closeInstallmentGroup: () => void;
}

const CLOSED = { detail: null, editing: null, deleting: null, installmentGroupId: null } as const;

export const useTxUIStore = create<TxUIState>((set) => ({
  detail: null,
  editing: null,
  deleting: null,
  installmentGroupId: null,
  openDetail: (item) => set({ ...CLOSED, detail: item }),
  openEdit: (item) => set({ ...CLOSED, editing: item }),
  openDelete: (item) => set({ ...CLOSED, deleting: item }),
  openInstallmentGroup: (groupId) => set({ ...CLOSED, installmentGroupId: groupId }),
  closeDetail: () => set({ detail: null }),
  closeEdit: () => set({ editing: null }),
  closeDelete: () => set({ deleting: null }),
  closeInstallmentGroup: () => set({ installmentGroupId: null }),
}));

/** Imperative helper for row components. */
export const openTxDetail = (item: TransactionListItem): void => useTxUIStore.getState().openDetail(item);

/** Imperative helper to open the installment-group list from a collapsed row. */
export const openInstallmentGroup = (groupId: string): void =>
  useTxUIStore.getState().openInstallmentGroup(groupId);
