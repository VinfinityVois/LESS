import { create } from "zustand";
import { getStatus, SystemStatus } from "../services/api";

interface SystemState {
  status: SystemStatus | null;
  backendOnline: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export const useSystemStore = create<SystemState>((set) => ({
  status: null,
  backendOnline: false,
  loading: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const status = await getStatus();
      set({ status, backendOnline: true, loading: false });
    } catch {
      set({ status: null, backendOnline: false, loading: false });
    }
  },
}));
