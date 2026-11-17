import React, { useState } from "react";
import { motion } from "motion/react";
import { CloudField, PlumPattern } from "../design/BackdropDecor";
import { PrimaryPillButton } from "../design/PrimaryPillButton";
import { IconButton } from "../design/IconButton";
import { Mascot } from "../design/Mascot";
import { Modal } from "../design/Modal";
import { SURFACES } from "../design/tokens";
import { SPRING } from "../design/motion";
import { play } from "../design/sound";
import { useSettings } from "../state/settings";

const HOWTO_TEXT = "Try to occupy the whole field with your color. Tapping a cell gives it 3 dots (or adds 1 if it's yours). When a cell's dots reach its neighbor count, it splits and adds 1 dot to each neighbor, capturing them. Last color standing wins!";

export function HomeFlow(props: {
  connected: boolean;
  name: string; setName: (v: string) => void;
  joinCode: string; setJoinCode: (v: string) => void;
  view: "landing" | "howto" | "create" | "join";
  setView: (v: "landing" | "howto" | "create" | "join") => void;
  onCreate: () => void; onJoin: () => void;
  onOpenSettings: () => void; onOpenHelp: () => void;
  showSettings: boolean; setShowSettings: (v: boolean) => void;
}) {
  const { connected, name, setName, joinCode, setJoinCode, view, setView, onCreate, onJoin, onOpenSettings, onOpenHelp, showSettings, setShowSettings } = props;
  const { settings, setMuted, setHaptics, setChainSpeed, setTurnTimer } = useSettings();
  const [playersCount, setPlayersCount] = useState(4);
  const [joinErr, setJoinErr] = useState(false);

  if (view === "howto") {
    return (
      <div className="cw-page-shell" style={{ background: SURFACES.azure, position: "relative", overflow: "hidden" }}>
        <div style={{ background: SURFACES.plum, height: "min(34vh, 320px)", position: "relative", overflow: "hidden", padding: "16px 16px 24px" }}>
          <PlumPattern />
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <IconButton variant="light" icon="back" ariaLabel="Back" onClick={() => { play("ui.back"); setView("landing"); }} />
            <div className="cw-display" style={{ color: SURFACES.whiteText, fontSize: "clamp(28px,7vw,40px)" }}>COLOR WARS</div>
            <div style={{ width: 56 }} />
          </div>
          <div style={{ position: "relative", zIndex: 1, marginTop: 16, display: "flex", justifyContent: "center" }}>
            <p className="cw-body-on-plum" style={{ maxWidth: "34ch", margin: 0 }}>{HOWTO_TEXT}</p>
          </div>
        </div>
        <div style={{ position: "relative", padding: "24px 16px 120px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "clamp(4px, 2vw, 16px)", flexWrap: "wrap", marginBottom: 8, maxWidth: 360 }}>
            <Mascot color="#ef4444" size="lg" state="entrance" animateKey={1} />
            <Mascot color="#3b82f6" size="lg" state="entrance" animateKey={2} />
            <Mascot color="#22c55e" size="lg" state="entrance" animateKey={3} />
            <Mascot color="#eab308" size="lg" state="entrance" animateKey={4} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
            <PrimaryPillButton label="PLAY" onClick={() => { play("ui.tap"); setView("create"); }} />
            <IconButton variant="navy" icon="help" ariaLabel="Help" onClick={() => { play("ui.tap"); onOpenHelp(); }} />
          </div>
        </div>
        <CloudField />
      </div>
    );
  }

  if (view === "create") {
    return (
      <div className="cw-page-shell cw-no-scrollbar" style={{ background: SURFACES.azure, position: "relative", overflowY: "auto" }}>
        <div style={{ background: SURFACES.plum, height: 120, position: "relative", overflow: "hidden", padding: "16px", display: "flex", alignItems: "center", gap: 12 }}>
          <PlumPattern />
          <div style={{ position: "relative", zIndex: 1 }}><IconButton variant="light" icon="back" ariaLabel="Back" onClick={() => { play("ui.back"); setView("landing"); }} /></div>
          <div className="cw-h1" style={{ color: SURFACES.whiteText, position: "relative", zIndex: 1 }}>Create room</div>
        </div>
        <div style={{ padding: "20px 16px 40px", maxWidth: 520, margin: "0 auto" }}>
          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>YOUR NAME</div>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={12} placeholder="Your name"
            className="cw-truncate"
            style={{ width: "100%", height: 56, borderRadius: 999, border: "none", padding: "0 20px", textAlign: "center", fontSize: 17, fontWeight: 700, color: SURFACES.ink, outline: "none", marginBottom: 16, background: SURFACES.cloud }} />
          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>PLAYERS</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {[2,3,4,5,6,7,8].map(n => (
              <button key={n} onClick={() => { setPlayersCount(n); play("ui.tap"); }}
                style={{ width: 56, height: 48, borderRadius: 16, border: "none", fontWeight: 800, fontSize: 18, background: playersCount===n ? SURFACES.action : SURFACES.cloud, color: playersCount===n ? SURFACES.whiteText : SURFACES.ink, transform: playersCount===n ? "rotate(-4deg)" : "none", cursor: "pointer" }}>{n}</button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div><div className="cw-caption" style={{ letterSpacing: 1 }}>Turn timer</div><div className="cw-caption">15 s per turn</div></div>
            <button onClick={() => { setTurnTimer(!settings.turnTimer); play("ui.tap"); }} style={{ width: 56, height: 32, borderRadius: 999, border: "none", background: settings.turnTimer ? SURFACES.action : SURFACES.pill, position: "relative", cursor: "pointer" }}>
              <span style={{ position: "absolute", top: 3, left: settings.turnTimer ? 27 : 3, width: 26, height: 26, borderRadius: "50%", background: SURFACES.cloud, transition: "left 150ms" }} />
            </button>
          </div>
          <div style={{ width: "92%", margin: "0 auto" }}>
            <PrimaryPillButton label="CREATE ROOM" onClick={onCreate} disabled={!connected} />
          </div>
        </div>
      </div>
    );
  }

  if (view === "join") {
    const code = joinCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0,5);
    return (
      <div className="cw-page-shell" style={{ background: SURFACES.azure, position: "relative" }}>
        <div style={{ background: SURFACES.plum, minHeight: 120, position: "relative", overflow: "hidden", padding: "16px", display: "flex", alignItems: "center", gap: 12 }}>
          <PlumPattern />
          <div style={{ position: "relative", zIndex: 2 }}><IconButton variant="light" icon="back" ariaLabel="Back" onClick={() => { play("ui.back"); setView("landing"); }} /></div>
          <div className="cw-h1" style={{ color: SURFACES.whiteText, position: "relative", zIndex: 1 }}>Join room</div>
        </div>
        <div style={{ padding: "24px 16px", maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
          <div className="cw-caption" style={{ marginBottom: 12, letterSpacing: 1 }}>Enter the room code</div>
          <input
            value={code}
            onChange={e => { setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5)); setJoinErr(false); }}
            maxLength={5}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            placeholder="ABCDE"
            autoFocus
            style={{
              width: "100%",
              maxWidth: 320,
              height: 64,
              borderRadius: 16,
              border: joinErr ? "3px solid #FE6057" : "3px solid transparent",
              background: SURFACES.cloud,
              color: SURFACES.ink,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "0.25em",
              textAlign: "center",
              textTransform: "uppercase",
              outline: "none",
              padding: "0 16px",
              margin: "0 auto 12px",
              display: "block",
              caretColor: SURFACES.action,
            }}
          />
          <div className="cw-caption" style={{ marginBottom: 24 }}>Ask a friend for their 5-letter room code</div>
          <div style={{ width: "92%", maxWidth: 320, margin: "0 auto" }}>
            <PrimaryPillButton label="JOIN" onClick={onJoin} disabled={!connected || code.length < 5} />
          </div>
        </div>
      </div>
    );
  }

  // landing
  return (
    <div className="cw-page-shell" style={{ background: SURFACES.azure, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <CloudField />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} style={{ position: "relative", zIndex: 1, textAlign: "center", width: "100%", maxWidth: 420 }}>
        <div className="cw-display" style={{ color: SURFACES.plum, marginBottom: 16 }}>COLOR WARS</div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "clamp(4px, 2vw, 14px)", flexWrap: "wrap", margin: "0 auto 20px", maxWidth: 340 }}>
          <Mascot color="#ef4444" size="lg" state="entrance" animateKey={1} />
          <Mascot color="#3b82f6" size="lg" state="entrance" animateKey={2} />
          <Mascot color="#22c55e" size="lg" state="entrance" animateKey={3} />
          <Mascot color="#eab308" size="lg" state="entrance" animateKey={4} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 16 }}>
          <PrimaryPillButton label="PLAY" onClick={() => { play("ui.tap"); setView("create"); }} />
          <IconButton variant="navy" icon="help" ariaLabel="How to play" onClick={() => { play("ui.tap"); setView("howto"); }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <button onClick={() => { play("ui.tap"); setView("create"); }} style={{ height: 56, padding: "0 28px", borderRadius: 999, border: "3px dashed var(--cw-ink-soft)", background: "transparent", color: SURFACES.ink, fontWeight: 700, fontSize: 17, cursor: "pointer" }}>Create room</button>
          <button onClick={() => { play("ui.tap"); setView("join"); }} style={{ height: 56, padding: "0 28px", borderRadius: 999, border: "3px dashed var(--cw-ink-soft)", background: "transparent", color: SURFACES.ink, fontWeight: 700, fontSize: 17, cursor: "pointer" }}>Join room</button>
        </div>
        <div style={{ marginTop: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <IconButton variant="ghost" icon={settings.muted ? "speaker-off" : "speaker-on"} ariaLabel="Sound" onClick={() => { setMuted(!settings.muted); play("ui.tap"); }} />
          <span className="cw-caption">v1.0</span>
          <IconButton variant="ghost" icon="gear" ariaLabel="Settings" onClick={() => { play("ui.tap"); onOpenSettings(); }} />
        </div>
        {!connected && <div className="cw-caption" style={{ marginTop: 8, color: "#FE6057" }}>Connecting…</div>}
      </motion.div>
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Settings">
        <SettingsRows />
      </Modal>
    </div>
  );
}

export function SettingsRows() {
  const { settings, setMuted, setHaptics, setTurnTimer } = useSettings();
  const row = (label: string, right: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
      <div className="cw-body" style={{ color: SURFACES.ink }}>{label}</div>{right}
    </div>
  );
  const toggle = (on: boolean, set: (v:boolean)=>void) => (
    <button onClick={() => { set(!on); play("ui.tap"); }} style={{ width: 56, height: 32, borderRadius: 999, border: "none", background: on ? SURFACES.action : SURFACES.pill, position: "relative", cursor: "pointer" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 27 : 3, width: 26, height: 26, borderRadius: "50%", background: SURFACES.cloud, transition: "left 150ms" }} />
    </button>
  );
  return (
    <div>
      {row("Sound", toggle(!settings.muted, (v)=>setMuted(!v)))}
      {row("Haptics", toggle(settings.haptics, setHaptics))}
      {row("Turn timer (15 s)", toggle(settings.turnTimer, setTurnTimer))}
      <div style={{ padding: "12px 0" }} className="cw-caption">How to play: tap your pieces to grow. 4 dots burst and fly to neighbors, capturing them. Last color standing wins!</div>
      <div className="cw-caption">v1.0.0</div>
    </div>
  );
}
