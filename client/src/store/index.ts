import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  token: string | null;
  setToken: (token: string | null) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      token: null,
      setToken: (token) => set({ token }),
      logout: () => set({ token: null }),
    }),
    {
      name: 'app-storage',
    }
  )
);
