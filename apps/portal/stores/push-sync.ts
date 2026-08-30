import { create } from "zustand";

type PushSyncStore = {
  suppressed: boolean;
  setSuppressed: (suppressed: boolean) => void;
};

export const usePushSyncStore = create<PushSyncStore>((set) => ({
  suppressed: false,
  setSuppressed: (suppressed) => set({ suppressed }),
}));
