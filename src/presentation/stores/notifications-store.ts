import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Read state for the (derived) notifications. Notifications are recomputed from
 * live data every render, so we track which ones the user already saw by a stable
 * key and persist it to localStorage. The bell + panel derive "unread" from this.
 */
interface NotificationsState {
  readonly readKeys: string[];
  markRead: (key: string) => void;
  markAllRead: (keys: readonly string[]) => void;
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set) => ({
      readKeys: [],
      markRead: (key) => set((s) => (s.readKeys.includes(key) ? s : { readKeys: [...s.readKeys, key] })),
      markAllRead: (keys) => set((s) => ({ readKeys: [...new Set([...s.readKeys, ...keys])] })),
    }),
    {
      name: "fincore-notif-read",
      // On the server `localStorage` is undefined; createJSONStorage catches the
      // resulting throw and falls back to no persistence (read state is client-only).
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
