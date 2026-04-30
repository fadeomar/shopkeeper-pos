"use client";

import { createContext, useContext, useState } from "react";
import type { Settings } from "@/types/domain";

interface SettingsContextValue {
  settings: Settings | null;
  setSettings: (s: Settings) => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: null,
  setSettings: () => undefined,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  return (
    <SettingsContext.Provider value={{ settings, setSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
