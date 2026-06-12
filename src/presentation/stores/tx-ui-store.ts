import { create } from "zustand";
import type { TransactionListItem } from "@/application/use-cases/get-transactions";

/**
 * Cross-screen transaction modal state (detail → edit / delete-scope). Rows on
 * any screen call `openTxDetail`; the modals themselves are mounted once in the
 * app layout (TxModalsHost).
 */
interface TxUIState {
  readonly detail: TransactionListItem | null;
  readonly editing: TransactionListItem | null;
  readonly deleting: TransactionListItem | null;
  openDetail: (item: TransactionListItem) => void;
  openEdit: (item: TransactionListItem) => void;
  openDelete: (item: TransactionListItem) => void;
  closeDetail: () => void;
  closeEdit: () => void;
  closeDelete: () => void;
}

export const useTxUIStore = create<TxUIState>((set) => ({
  detail: null,
  editing: null,
  deleting: null,
  openDetail: (item) => set({ detail: item, editing: null, deleting: null }),
  openEdit: (item) => set({ detail: null, editing: item, deleting: null }),
  openDelete: (item) => set({ detail: null, editing: null, deleting: item }),
  closeDetail: () => set({ detail: null }),
  closeEdit: () => set({ editing: null }),
  closeDelete: () => set({ deleting: null }),
}));

/** Imperative helper for row components. */
export const openTxDetail = (item: TransactionListItem): void => useTxUIStore.getState().openDetail(item);
