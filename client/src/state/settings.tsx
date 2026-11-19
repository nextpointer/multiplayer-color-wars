import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { setMuted as setSoundMuted, setHapticsEnabled } from "../design/sound";

export type ChainSpeedSetting = "normal" | "fast";
export type AnimationQuality = "full" | "reduced" | "minimal";

export interface Settings {
  muted: boolean;
  haptics: boolean;
  chainSpeed: ChainSpeedSetting;
  animationQuality: AnimationQuality;
  timerSounds: boolean;
}

const DEFAULTS: Settings = { muted: false, haptics: true, chainSpeed: "normal", animationQuality: "full", timerSounds: true };

function load(): Settings {
  try {
    const aq = localStorage.getItem("cw.animQuality");
    return {
      muted: localStorage.getItem("cw.muted") === "1",
      haptics: localStorage.getItem("cw.haptics") !== "0",
      chainSpeed: "normal",
      animationQuality: aq === "reduced" || aq === "minimal" ? aq : "full",
      timerSounds: localStorage.getItem("cw.timerSounds") !== "0",
    };
  } catch { return { ...DEFAULTS }; }
}

function save(s: Settings) {
  try {
    localStorage.setItem("cw.muted", s.muted ? "1" : "0");
    localStorage.setItem("cw.haptics", s.haptics ? "1" : "0");
    localStorage.setItem("cw.chainSpeed", "normal");
    localStorage.setItem("cw.animQuality", s.animationQuality);
    localStorage.setItem("cw.timerSounds", s.timerSounds ? "1" : "0");
  } catch {}
}

type Ctx = {
  settings: Settings;
  setMuted: (v: boolean) => void;
  setHaptics: (v: boolean) => void;
  setChainSpeed: (v: ChainSpeedSetting) => void;
  setAnimationQuality: (v: AnimationQuality) => void;
  setTimerSounds: (v: boolean) => void;
};

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => load());
  useEffect(() => { setSoundMuted(settings.muted); setHapticsEnabled(settings.haptics); save(settings); }, [settings]);

  const value = useMemo<Ctx>(() => ({
    settings,
    setMuted: (v) => setSettings(s => ({ ...s, muted: v })),
    setHaptics: (v) => setSettings(s => ({ ...s, haptics: v })),
    setChainSpeed: (v) => setSettings(s => ({ ...s, chainSpeed: v })),
    setAnimationQuality: (v) => setSettings(s => ({ ...s, animationQuality: v })),
    setTimerSounds: (v) => setSettings(s => ({ ...s, timerSounds: v })),
  }), [settings]);

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
