import { create } from "zustand";

type ConnectivityStore = {
  /** The browser reports no network ("offline" event / navigator.onLine). */
  browserOffline: boolean;
  /** A request failed with no HTTP response while the browser was online:
   * the API cannot be reached (server down, VPN/proxy dropped, etc.). */
  serverUnreachable: boolean;
  /** Whether the API has answered at least once in this page session. Tells a
   * lost connection apart from a first-contact failure, which is more likely a
   * setup problem (wrong API URL or CORS origin) — see parseApiError. */
  hasReachedServer: boolean;
  setBrowserOffline: (offline: boolean) => void;
  markServerUnreachable: () => void;
  markServerReachable: () => void;
};

// Setters bail out when nothing changes: the query/mutation caches call them on
// every settled request, and a no-op set() would still notify subscribers.
export const useConnectivityStore = create<ConnectivityStore>((set, get) => ({
  browserOffline:
    typeof navigator !== "undefined" ? navigator.onLine === false : false,
  serverUnreachable: false,
  hasReachedServer: false,
  setBrowserOffline: (offline) => {
    if (get().browserOffline !== offline) set({ browserOffline: offline });
  },
  markServerUnreachable: () => {
    if (!get().serverUnreachable) set({ serverUnreachable: true });
  },
  markServerReachable: () => {
    const state = get();
    if (state.serverUnreachable || !state.hasReachedServer) {
      set({ serverUnreachable: false, hasReachedServer: true });
    }
  },
}));
