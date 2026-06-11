import { create } from "zustand";

/** Which lens the money views use: everything ("general") vs only the user's own share ("personal"). */
export type FinanceView = "general" | "personal";

export type ToastTone = "success" | "error" | "info";
export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

interface UIState {
  /** Hide-balances ("R$ ••••") mode. */
  readonly privacy: boolean;
  togglePrivacy: () => void;
  readonly view: FinanceView;
  setView: (view: FinanceView) => void;
  readonly toasts: Toast[];
  /** Enqueue a toast; returns its id. */
  toast: (message: string, tone?: ToastTone) => number;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useUIStore = create<UIState>((set) => ({
  privacy: false,
  togglePrivacy: () => set((s) => ({ privacy: !s.privacy })),
  view: "general",
  setView: (view) => set({ view }),
  toasts: [],
  toast: (message, tone = "success") => {
    toastSeq += 1;
    const id = toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper for non-hook contexts (e.g. form submit handlers). */
export const toast = (message: string, tone?: ToastTone): number =>
  useUIStore.getState().toast(message, tone);
