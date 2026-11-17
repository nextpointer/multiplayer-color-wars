import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { setMuted as setSoundMuted } from "../design/sound";

export type ChainSpeedSetting = "normal" | "fast";

export interface Settings {
  muted: boolean;
  haptics: boolean;
  chainSpeed: ChainSpeedSetting;
}

const DEFAULTS: Settings = { muted: false, haptics: true, chainSpeed: "normal" };

function load(): Settings {
  try {
    return {
      muted: localStorage.getItem("cw.muted") === "1",
      haptics: localStorage.getItem("cw.haptics") !== "0",
      chainSpeed: "normal",
    };
  } catch { return { ...DEFAULTS }; }
}

function save(s: Settings) {
  try {
    localStorage.setItem("cw.muted", s.muted ? "1" : "0");
    localStorage.setItem("cw.haptics", s.haptics ? "1" : "0");
    localStorage.setItem("cw.chainSpeed", "normal");
  } catch {}
}

type Ctx = {
  settings: Settings;
  setMuted: (v: boolean) => void;
  setHaptics: (v: boolean) => void;
  setChainSpeed: (v: ChainSpeedSetting) => void;
};

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => load());
  useEffect(() => { setSoundMuted(settings.muted); save(settings); }, [settings]);

  const value = useMemo<Ctx>(() => ({
    settings,
    setMuted: (v) => setSettings(s => ({ ...s, muted: v })),
    setHaptics: (v) => setSettings(s => ({ ...s, haptics: v })),
    setChainSpeed: (v) => setSettings(s => ({ ...s, chainSpeed: v })),
  }), [settings]);

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
