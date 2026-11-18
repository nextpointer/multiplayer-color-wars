import React, { useState } from "react";
import { motion } from "motion/react";
import { CloudField, PlumPattern } from "../design/BackdropDecor";
import { PrimaryPillButton } from "../design/PrimaryPillButton";
import { IconButton } from "../design/IconButton";
import { Mascot } from "../design/Mascot";
import { Modal } from "../design/Modal";
import { SURFACES } from "../design/tokens";
import { play } from "../design/sound";
import { useSettings } from "../state/settings";
import type { BotDifficulty } from "../engine/bot";
import { gridOptionsForPlayers, recommendedBoardSize, type GridSize } from "@game/shared";

const HOWTO_TEXT = "Try to occupy the whole field with your color. On your first turn, tap an empty cell to place your starting cell with 3 dots. After that, you can only tap your own cells to add 1 dot. When a cell's dots reach its neighbor count, it splits and adds 1 dot to each neighbor, capturing them. Last color standing wins!";

export type HomeView = "landing" | "howto" | "create" | "join" | "single";

const DIFFICULTIES: { id: BotDifficulty; label: string; desc: string }[] = [
  { id: "easy", label: "Easy", desc: "Relaxed opponent, good for learning" },
  { id: "medium", label: "Medium", desc: "Smart moves and solid pressure" },
  { id: "hard", label: "Hard", desc: "Looks ahead and punishes mistakes" },
];

export function HomeFlow(props: {
  connected: boolean;
  name: string; setName: (v: string) => void;
  joinCode: string; setJoinCode: (v: string) => void;
  view: HomeView;
  setView: (v: HomeView) => void;
  onCreate: (opts: { maxPlayers: number; grid: GridSize | null }) => void; onJoin: () => void;
  onStartSingle: (difficulty: BotDifficulty) => void;
  onOpenSettings: () => void; onOpenHelp: () => void;
  showSettings: boolean; setShowSettings: (v: boolean) => void;
}) {
  const { connected, name, setName, joinCode, setJoinCode, view, setView, onCreate, onJoin, onStartSingle, onOpenSettings, onOpenHelp, showSettings, setShowSettings } = props;
  const { settings, setMuted } = useSettings();
  const [playersCount, setPlayersCount] = useState(4);
  const [gridChoice, setGridChoice] = useState<GridSize | null>(null);
  const [joinErr, setJoinErr] = useState(false);
  const [difficulty, setDifficulty] = useState<BotDifficulty>("medium");

  if (view === "howto") {
    return (
      <div className="cw-page-shell cw-no-scrollbar" style={{ background: SURFACES.azure, position: "relative", overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ background: SURFACES.plum, minHeight: "min(38vh, 300px)", position: "relative", overflow: "hidden", padding: "16px 16px 24px" }}>
          <PlumPattern />
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <IconButton variant="light" icon="back" ariaLabel="Back" onClick={() => { play("ui.back"); setView("landing"); }} />
            <div className="cw-display" style={{ color: SURFACES.whiteText, fontSize: "clamp(24px,7vw,40px)", textAlign: "center", flex: 1 }}>COLOR WARS</div>
            <div style={{ width: 56, flex: "0 0 56px" }} />
          </div>
          <div style={{ position: "relative", zIndex: 1, marginTop: 14, display: "flex", justifyContent: "center" }}>
            <p className="cw-body-on-plum" style={{ maxWidth: "36ch", margin: 0 }}>{HOWTO_TEXT}</p>
          </div>
        </div>
        <div style={{ position: "relative", padding: "20px 16px 40px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "clamp(4px, 2vw, 16px)", flexWrap: "wrap", marginBottom: 12, maxWidth: 360 }}>
            <Mascot color="#ef4444" size="lg" state="entrance" animateKey={1} smile />
            <Mascot color="#3b82f6" size="lg" state="entrance" animateKey={2} smile />
            <Mascot color="#22c55e" size="lg" state="entrance" animateKey={3} smile />
            <Mascot color="#eab308" size="lg" state="entrance" animateKey={4} smile />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
            <PrimaryPillButton label="VS COMPUTER" onClick={() => { play("ui.tap"); setView("single"); }} />
            <IconButton variant="navy" icon="help" ariaLabel="Help" onClick={() => { play("ui.tap"); onOpenHelp(); }} />
          </div>
        </div>
        <CloudField />
      </div>
    );
  }

  if (view === "single") {
    const canStart = name.trim().length > 0;
    return (
      <div className="cw-page-shell cw-no-scrollbar" style={{ background: SURFACES.azure, position: "relative", overflowY: "auto" }}>
        <div style={{ background: SURFACES.plum, minHeight: 120, position: "relative", overflow: "hidden", padding: "16px", display: "flex", alignItems: "center", gap: 12 }}>
          <PlumPattern />
          <div style={{ position: "relative", zIndex: 1 }}><IconButton variant="light" icon="back" ariaLabel="Back" onClick={() => { play("ui.back"); setView("landing"); }} /></div>
          <div style={{ position: "relative", zIndex: 1, minWidth: 0 }}>
            <div className="cw-h1" style={{ color: SURFACES.whiteText }}>Vs Computer</div>
            <div className="cw-caption" style={{ color: "rgba(255,255,255,0.85)", marginTop: 2 }}>Play locally against the machine</div>
          </div>
        </div>
        <div style={{ padding: "20px 16px 40px", maxWidth: 520, margin: "0 auto" }}>
          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>YOUR NAME</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={12}
            placeholder="Your name"
            className="cw-truncate"
            style={{ width: "100%", height: 56, borderRadius: 999, border: "none", padding: "0 20px", textAlign: "center", fontSize: 17, fontWeight: 700, color: SURFACES.ink, outline: "none", marginBottom: 18, background: SURFACES.cloud }}
          />
          <div className="cw-caption" style={{ marginBottom: 8, letterSpacing: 1 }}>DIFFICULTY</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
            {DIFFICULTIES.map(d => {
              const active = difficulty === d.id;
              return (
                <button key={d.id} onClick={() => { setDifficulty(d.id); play("ui.tap"); }}
                  style={{ height: 48, borderRadius: 16, border: "none", fontWeight: 800, fontSize: 16, background: active ? SURFACES.action : SURFACES.cloud, color: active ? SURFACES.whiteText : SURFACES.ink, transform: active ? "rotate(-2deg)" : "none", cursor: "pointer" }}>
                  {d.label}
                </button>
              );
            })}
          </div>
          <div style={{ background: "rgba(255,255,255,0.35)", borderRadius: 16, padding: "12px 14px", marginBottom: 22, textAlign: "center" }}>
            <div className="cw-body" style={{ color: SURFACES.ink, fontWeight: 700, marginBottom: 2 }}>{DIFFICULTIES.find(d => d.id === difficulty)?.label}</div>
            <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>{DIFFICULTIES.find(d => d.id === difficulty)?.desc}</div>
          </div>
          <div style={{ width: "100%", maxWidth: 320, margin: "0 auto", display: "flex", justifyContent: "center" }}>
            <PrimaryPillButton label="START GAME" onClick={() => onStartSingle(difficulty)} disabled={!canStart} />
          </div>
          {!canStart && <div className="cw-caption" style={{ marginTop: 10, textAlign: "center" }}>Enter your name to play</div>}
        </div>
      </div>
    );
  }

  if (view === "create") {
    const gridOptions = gridOptionsForPlayers(playersCount);
    const defaultGrid = recommendedBoardSize(playersCount);
    const isDefaultGrid = !gridChoice;
    const sameGrid = (a: GridSize | null, b: GridSize) => !!a && a.rows === b.rows && a.cols === b.cols;
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
              <button key={n} onClick={() => { setPlayersCount(n); setGridChoice(null); play("ui.tap"); }}
                style={{ width: 56, height: 48, borderRadius: 16, border: "none", fontWeight: 800, fontSize: 18, background: playersCount===n ? SURFACES.action : SURFACES.cloud, color: playersCount===n ? SURFACES.whiteText : SURFACES.ink, transform: playersCount===n ? "rotate(-4deg)" : "none", cursor: "pointer" }}>{n}</button>
            ))}
          </div>

          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>GRID SIZE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <button
              onClick={() => { setGridChoice(null); play("ui.tap"); }}
              style={{
                height: 44, padding: "0 14px", borderRadius: 14, border: "none", fontWeight: 800, fontSize: 15, cursor: "pointer",
                background: isDefaultGrid ? SURFACES.action : SURFACES.cloud,
                color: isDefaultGrid ? SURFACES.whiteText : SURFACES.ink,
                transform: isDefaultGrid ? "rotate(-2deg)" : "none",
              }}
            >
              Default ({defaultGrid.rows}×{defaultGrid.cols})
            </button>
            {gridOptions.map((g) => {
              const active = sameGrid(gridChoice, g);
              return (
                <button
                  key={`${g.rows}x${g.cols}`}
                  onClick={() => { setGridChoice(g); play("ui.tap"); }}
                  style={{
                    height: 44, padding: "0 14px", borderRadius: 14, border: "none", fontWeight: 800, fontSize: 15, cursor: "pointer",
                    background: active ? SURFACES.action : SURFACES.cloud,
                    color: active ? SURFACES.whiteText : SURFACES.ink,
                    transform: active ? "rotate(-2deg)" : "none",
                  }}
                >
                  {g.rows}×{g.cols}
                </button>
              );
            })}
          </div>
          <div className="cw-caption" style={{ marginBottom: 22, color: SURFACES.inkSoft }}>
            More players unlock larger grid options. Default picks a recommended size automatically.
          </div>

          <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
            <PrimaryPillButton label="CREATE ROOM" onClick={() => onCreate({ maxPlayers: playersCount, grid: gridChoice })} disabled={!connected} />
          </div>
          {!connected && <div className="cw-caption" style={{ marginTop: 10, textAlign: "center", color: "#FE6057" }}>Connecting to server…</div>}
        </div>
      </div>
    );
  }

  if (view === "join") {
    const code = joinCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0,5);
    const canJoin = connected && code.length >= 5 && name.trim().length > 0;
    return (
      <div className="cw-page-shell cw-no-scrollbar" style={{ background: SURFACES.azure, position: "relative", overflowY: "auto" }}>
        <div style={{ background: SURFACES.plum, minHeight: 120, position: "relative", overflow: "hidden", padding: "16px", display: "flex", alignItems: "center", gap: 12 }}>
          <PlumPattern />
          <div style={{ position: "relative", zIndex: 2 }}><IconButton variant="light" icon="back" ariaLabel="Back" onClick={() => { play("ui.back"); setView("landing"); }} /></div>
          <div className="cw-h1" style={{ color: SURFACES.whiteText, position: "relative", zIndex: 1 }}>Join room</div>
        </div>
        <div style={{ padding: "24px 16px 40px", maxWidth: 520, margin: "0 auto" }}>
          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>YOUR NAME</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={12}
            placeholder="Your name"
            className="cw-truncate"
            style={{ width: "100%", height: 56, borderRadius: 999, border: "none", padding: "0 20px", textAlign: "center", fontSize: 17, fontWeight: 700, color: SURFACES.ink, outline: "none", marginBottom: 18, background: SURFACES.cloud }}
          />
          <div className="cw-caption" style={{ marginBottom: 8, letterSpacing: 1, textAlign: "center" }}>ROOM CODE</div>
          <input
            value={code}
            onChange={e => { setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5)); setJoinErr(false); }}
            maxLength={5}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            placeholder="ABCDE"
            autoFocus={!name.trim()}
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
              margin: "0 auto 10px",
              display: "block",
              caretColor: SURFACES.action,
            }}
          />
          <div className="cw-caption" style={{ marginBottom: 22, textAlign: "center" }}>Ask a friend for their 5-letter room code</div>
          <div style={{ width: "100%", maxWidth: 320, margin: "0 auto", display: "flex", justifyContent: "center" }}>
            <PrimaryPillButton label="JOIN ROOM" onClick={onJoin} disabled={!canJoin} />
          </div>
          {!name.trim() && <div className="cw-caption" style={{ marginTop: 10, textAlign: "center" }}>Enter your name to join</div>}
          {!connected && name.trim() && <div className="cw-caption" style={{ marginTop: 10, textAlign: "center", color: "#FE6057" }}>Connecting to server…</div>}
        </div>
      </div>
    );
  }

  // landing
  return (
    <div className="cw-page-shell cw-no-scrollbar" style={{ background: SURFACES.azure, position: "relative", overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column" }}>
      <CloudField />
      <div style={{ flex: 1, minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "max(20px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom))" }}>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} style={{ position: "relative", zIndex: 1, textAlign: "center", width: "100%", maxWidth: 420 }}>
          <div className="cw-display" style={{ color: SURFACES.plum, marginBottom: 12 }}>COLOR WARS</div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "clamp(2px, 1.5vw, 12px)", flexWrap: "wrap", margin: "0 auto 16px", maxWidth: 340 }}>
            <Mascot color="#ef4444" size="lg" state="entrance" animateKey={1} smile />
            <Mascot color="#3b82f6" size="lg" state="entrance" animateKey={2} smile />
            <Mascot color="#22c55e" size="lg" state="entrance" animateKey={3} smile />
            <Mascot color="#eab308" size="lg" state="entrance" animateKey={4} smile />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <PrimaryPillButton label="VS COMPUTER" onClick={() => { play("ui.tap"); setView("single"); }} />
            <IconButton variant="navy" icon="help" ariaLabel="How to play" onClick={() => { play("ui.tap"); setView("howto"); }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", width: "100%" }}>
            <button onClick={() => { play("ui.tap"); setView("create"); }} style={{ width: "min(100%, 280px)", height: 54, padding: "0 24px", borderRadius: 999, border: "3px dashed var(--cw-ink-soft)", background: "rgba(255,255,255,0.35)", color: SURFACES.ink, fontWeight: 700, fontSize: 17, cursor: "pointer" }}>Create online room</button>
            <button onClick={() => { play("ui.tap"); setView("join"); }} style={{ width: "min(100%, 280px)", height: 54, padding: "0 24px", borderRadius: 999, border: "3px dashed var(--cw-ink-soft)", background: "rgba(255,255,255,0.35)", color: SURFACES.ink, fontWeight: 700, fontSize: 17, cursor: "pointer" }}>Join room</button>
          </div>
          <div style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <IconButton variant="ghost" icon={settings.muted ? "speaker-off" : "speaker-on"} ariaLabel="Sound" onClick={() => { setMuted(!settings.muted); play("ui.tap"); }} />
            <span className="cw-caption">v1.0</span>
            <IconButton variant="ghost" icon="gear" ariaLabel="Settings" onClick={() => { play("ui.tap"); onOpenSettings(); }} />
          </div>
          {!connected && <div className="cw-caption" style={{ marginTop: 10, color: SURFACES.inkSoft }}>Online multiplayer: connecting…</div>}
        </motion.div>
      </div>
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Settings">
        <SettingsRows />
      </Modal>
    </div>
  );
}

export function SettingsRows() {
  const { settings, setMuted, setHaptics } = useSettings();
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
      <div style={{ padding: "12px 0" }} className="cw-caption">How to play: place your first 3-dot cell on an empty spot, then tap your own cells to grow. When a cell reaches its neighbor count it bursts to neighbors, capturing them. Last color standing wins!</div>
      <div className="cw-caption">Single player: play locally vs the computer (Easy / Medium / Hard). Online multiplayer requires a server connection.</div>
      <div className="cw-caption" style={{ marginTop: 4 }}>v1.0.0</div>
    </div>
  );
}
