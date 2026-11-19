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
import { BOARD_SHAPES, gridOptionsForPlayers, recommendedBoardSize, type BoardShape, type GridSize } from "@game/shared";

const HOWTO_TEXT = "Tap an empty cell to start with 3 dots. Then tap your own cells to add dots. When a cell is full, it bursts to neighbors and captures them. Last color standing — or most dots when time runs out — wins!";

export type HomeView = "landing" | "howto" | "create" | "join" | "single";

const DIFFICULTIES: { id: BotDifficulty; label: string; desc: string }[] = [
  { id: "easy", label: "Easy", desc: "Relaxed opponent, good for learning" },
  { id: "medium", label: "Medium", desc: "Smart moves and solid pressure" },
  { id: "hard", label: "Hard", desc: "Looks ahead and punishes mistakes" },
];

export type GameTimeMinutes = 10 | 20 | 30;
const GAME_TIME_OPTIONS: { id: GameTimeMinutes; label: string; desc: string }[] = [
  { id: 10, label: "10 min", desc: "Quick match" },
  { id: 20, label: "20 min", desc: "Balanced game" },
  { id: 30, label: "30 min", desc: "Epic battle" },
];

export type TeamMode = "off" | "2v2" | "3v3";
export type CreateOpts = { maxPlayers: number; grid: GridSize | null; shape: BoardShape; gameTimeMinutes: GameTimeMinutes; teamMode: TeamMode };
export type SingleOpts = { difficulty: BotDifficulty; grid: GridSize | null; shape: BoardShape; gameTimeMinutes: GameTimeMinutes };

export function HomeFlow(props: {
  connected: boolean;
  name: string; setName: (v: string) => void;
  joinCode: string; setJoinCode: (v: string) => void;
  view: HomeView;
  setView: (v: HomeView) => void;
  onCreate: (opts: CreateOpts) => void; onJoin: () => void; onSpectate: () => void;
  onStartSingle: (opts: SingleOpts) => void;
  onOpenSettings: () => void; onOpenHelp: () => void;
  showSettings: boolean; setShowSettings: (v: boolean) => void;
}) {
  const { connected, name, setName, joinCode, setJoinCode, view, setView, onCreate, onJoin, onSpectate, onStartSingle, onOpenSettings, onOpenHelp, showSettings, setShowSettings } = props;
  const { settings, setMuted } = useSettings();
  const [playersCount, setPlayersCount] = useState(4);
  const [gridChoice, setGridChoice] = useState<GridSize | null>(null);
  const [shapeChoice, setShapeChoice] = useState<BoardShape>("rectangle");
  const [gameTimeMinutes, setGameTimeMinutes] = useState<GameTimeMinutes>(10);
  const [teamMode, setTeamMode] = useState<TeamMode>("off");
  const [actionBusy, setActionBusy] = useState(false);
  React.useEffect(() => { setActionBusy(false); }, [view, connected]);
  const [singleGridChoice, setSingleGridChoice] = useState<GridSize | null>(null);
  const [singleShape, setSingleShape] = useState<BoardShape>("rectangle");
  const [singleGameTimeMinutes, setSingleGameTimeMinutes] = useState<GameTimeMinutes>(10);
  const [joinErr, setJoinErr] = useState(false);
  const [difficulty, setDifficulty] = useState<BotDifficulty>("medium");

  if (view === "howto") {
    const Step = ({ emoji, title, text, color, delay }: { emoji: string; title: string; text: string; color: string; delay: number }) => (
      <motion.div
        initial={{ opacity: 0, y: 14, rotate: -1 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ delay, duration: 0.28, ease: "easeOut" }}
        style={{ background: "#fff", borderRadius: 20, padding: "14px 14px 14px 12px", boxShadow: "0 8px 18px rgba(0,0,0,0.07)", border: `2px solid ${color}33`, display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left" }}
      >
        <div style={{ width: 42, height: 42, borderRadius: 14, background: `${color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flex: "0 0 auto" }} aria-hidden>{emoji}</div>
        <div>
          <div className="cw-body" style={{ color: SURFACES.ink, fontWeight: 900, marginBottom: 2 }}>{title}</div>
          <div className="cw-caption" style={{ color: SURFACES.inkSoft, lineHeight: 1.4, fontSize: 13 }}>{text}</div>
        </div>
      </motion.div>
    );
    return (
      <div className="cw-page-shell cw-no-scrollbar" style={{ background: "linear-gradient(180deg, #FFF6D8 0%, #EAF6FF 55%, #F7FFF0 100%)", position: "relative", overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ padding: "14px 16px 10px", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <IconButton variant="light" icon="back" ariaLabel="Back" onClick={() => { play("ui.back"); setView("landing"); }} />
            <div className="cw-display" style={{ color: SURFACES.plum, fontSize: "clamp(26px,7vw,38px)", textAlign: "center", flex: 1 }}>How to play</div>
            <div style={{ width: 56, flex: "0 0 56px" }} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 8, marginTop: 8, marginBottom: 6 }}>
            <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}><Mascot color="#ef4444" size="md" smile /></motion.div>
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2.0, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}><Mascot color="#3b82f6" size="lg" state="cheer" animateKey="h1" smile /></motion.div>
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut", delay: 0.35 }}><Mascot color="#22c55e" size="md" smile /></motion.div>
          </div>
          <div className="cw-body" style={{ textAlign: "center", color: SURFACES.ink, fontWeight: 800, marginBottom: 14 }}>Fill the board with your color and make it pop! 💥</div>
        </div>
        <div style={{ padding: "0 16px 44px", maxWidth: 520, margin: "0 auto", display: "grid", gap: 12, position: "relative", zIndex: 1 }}>
          <Step emoji="🎯" title="Start with 3 dots" color="#3b82f6" delay={0.02} text="Tap any empty cell to place 3 dots right away — everywhere on the board!" />
          <Step emoji="➕" title="Grow your cells" color="#22c55e" delay={0.07} text="After your first move, tap your own cells to add dots. Stack them up!" />
          <Step emoji="💥" title="Pop and spread" color="#ef4444" delay={0.12} text="When a cell is full, it bursts and sends dots to neighbors — capturing them in a chain reaction." />
          <Step emoji="⏱️" title="Beat the clock" color="#f59e0b" delay={0.17} text="Each turn is 1 minute. The whole game has a timer too — keep an eye on the ring!" />
          <Step emoji="👑" title="Win the board" color="#a855f7" delay={0.22} text="Last color standing wins. If time runs out, the player with the most dots takes it!" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            <PrimaryPillButton label="LET'S PLAY" onClick={() => { play("ui.tap"); setView("single"); }} />
          </div>
        </div>
        <CloudField />
      </div>
    );
  }

  if (view === "single") {
    const canStart = name.trim().length > 0;
    const singleGridOptions = gridOptionsForPlayers(2);
    const singleDefaultGrid = recommendedBoardSize(2);
    const isDefaultSingleGrid = !singleGridChoice;
    const sameGrid = (a: GridSize | null, b: GridSize) => !!a && a.rows === b.rows && a.cols === b.cols;
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
          <div style={{ background: "rgba(255,255,255,0.35)", borderRadius: 16, padding: "12px 14px", marginBottom: 16, textAlign: "center" }}>
            <div className="cw-body" style={{ color: SURFACES.ink, fontWeight: 700, marginBottom: 2 }}>{DIFFICULTIES.find(d => d.id === difficulty)?.label}</div>
            <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>{DIFFICULTIES.find(d => d.id === difficulty)?.desc}</div>
          </div>

          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>BOARD SHAPE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {BOARD_SHAPES.map(s => {
              const active = singleShape === s.id;
              return (
                <button key={s.id} onClick={() => { setSingleShape(s.id); play("ui.tap"); }}
                  style={{ height: 40, padding: "0 12px", borderRadius: 14, border: "none", fontWeight: 800, fontSize: 14, cursor: "pointer", background: active ? SURFACES.action : SURFACES.cloud, color: active ? SURFACES.whiteText : SURFACES.ink, transform: active ? "rotate(-2deg)" : "none" }}>
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>GRID SIZE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <button onClick={() => { setSingleGridChoice(null); play("ui.tap"); }}
              style={{ height: 40, padding: "0 12px", borderRadius: 14, border: "none", fontWeight: 800, fontSize: 14, cursor: "pointer", background: isDefaultSingleGrid ? SURFACES.action : SURFACES.cloud, color: isDefaultSingleGrid ? SURFACES.whiteText : SURFACES.ink, transform: isDefaultSingleGrid ? "rotate(-2deg)" : "none" }}>
              Default ({singleDefaultGrid.rows}×{singleDefaultGrid.cols})
            </button>
            {singleGridOptions.map((g) => {
              const active = sameGrid(singleGridChoice, g);
              return (
                <button key={`${g.rows}x${g.cols}`} onClick={() => { setSingleGridChoice(g); play("ui.tap"); }}
                  style={{ height: 40, padding: "0 12px", borderRadius: 14, border: "none", fontWeight: 800, fontSize: 14, cursor: "pointer", background: active ? SURFACES.action : SURFACES.cloud, color: active ? SURFACES.whiteText : SURFACES.ink, transform: active ? "rotate(-2deg)" : "none" }}>
                  {g.rows}×{g.cols}
                </button>
              );
            })}
          </div>

          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>GAME TIMER</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {GAME_TIME_OPTIONS.map(t => {
              const active = singleGameTimeMinutes === t.id;
              return (
                <button key={t.id} onClick={() => { setSingleGameTimeMinutes(t.id); play("ui.tap"); }}
                  title={t.desc}
                  style={{ height: 44, padding: "0 14px", borderRadius: 14, border: "none", fontWeight: 800, fontSize: 15, cursor: "pointer", background: active ? SURFACES.action : SURFACES.cloud, color: active ? SURFACES.whiteText : SURFACES.ink, transform: active ? "rotate(-2deg)" : "none", boxShadow: active ? "0 6px 14px rgba(0,194,238,0.25)" : "none" }}>
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="cw-caption" style={{ marginBottom: 18, color: SURFACES.inkSoft }}>
            Each turn is always 1 minute. When the overall game timer ends, the player with the most dots wins.
          </div>

          <div style={{ width: "100%", maxWidth: 320, margin: "0 auto", display: "flex", justifyContent: "center" }}>
            <PrimaryPillButton label="START GAME" onClick={() => onStartSingle({ difficulty, grid: singleGridChoice, shape: singleShape, gameTimeMinutes: singleGameTimeMinutes })} disabled={!canStart} />
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
              <button key={n} onClick={() => { setPlayersCount(n); setGridChoice(null); if (teamMode === "2v2" && n !== 4) setTeamMode("off"); if (teamMode === "3v3" && n !== 6) setTeamMode("off"); play("ui.tap"); }}
                style={{ width: 56, height: 48, borderRadius: 16, border: "none", fontWeight: 800, fontSize: 18, background: playersCount===n ? SURFACES.action : SURFACES.cloud, color: playersCount===n ? SURFACES.whiteText : SURFACES.ink, transform: playersCount===n ? "rotate(-4deg)" : "none", cursor: "pointer" }}>{n}</button>
            ))}
          </div>

          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>TEAM MODE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {([
              { id: "off" as TeamMode, label: "FFA", enabled: true },
              { id: "2v2" as TeamMode, label: "2v2", enabled: playersCount === 4 },
              { id: "3v3" as TeamMode, label: "3v3", enabled: playersCount === 6 },
            ]).map(t => {
              const active = teamMode === t.id;
              return (
                <button key={t.id} onClick={() => { if (!t.enabled) return; setTeamMode(t.id); play("ui.tap"); }}
                  disabled={!t.enabled}
                  style={{ height: 40, padding: "0 12px", borderRadius: 14, border: "none", fontWeight: 800, fontSize: 14, cursor: t.enabled ? "pointer" : "default", opacity: t.enabled ? 1 : 0.45, background: active ? SURFACES.action : SURFACES.cloud, color: active ? SURFACES.whiteText : SURFACES.ink, transform: active ? "rotate(-2deg)" : "none" }}>
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="cw-caption" style={{ marginBottom: 14, color: SURFACES.inkSoft }}>
            2v2 needs 4 players, 3v3 needs 6 players. Teams win together.
          </div>

          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>BOARD SHAPE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {BOARD_SHAPES.map(s => {
              const active = shapeChoice === s.id;
              return (
                <button key={s.id} onClick={() => { setShapeChoice(s.id); play("ui.tap"); }}
                  style={{ height: 40, padding: "0 12px", borderRadius: 14, border: "none", fontWeight: 800, fontSize: 14, cursor: "pointer", background: active ? SURFACES.action : SURFACES.cloud, color: active ? SURFACES.whiteText : SURFACES.ink, transform: active ? "rotate(-2deg)" : "none" }}>
                  {s.label}
                </button>
              );
            })}
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
          <div className="cw-caption" style={{ marginBottom: 14, color: SURFACES.inkSoft }}>
            More players unlock larger grid options. Shapes can trim the grid into different board styles.
          </div>

          <div className="cw-caption" style={{ marginBottom: 6, letterSpacing: 1 }}>GAME TIMER</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {GAME_TIME_OPTIONS.map(t => {
              const active = gameTimeMinutes === t.id;
              return (
                <button key={t.id} onClick={() => { setGameTimeMinutes(t.id); play("ui.tap"); }}
                  title={t.desc}
                  style={{ height: 44, padding: "0 14px", borderRadius: 14, border: "none", fontWeight: 800, fontSize: 15, cursor: "pointer", background: active ? SURFACES.action : SURFACES.cloud, color: active ? SURFACES.whiteText : SURFACES.ink, transform: active ? "rotate(-2deg)" : "none", boxShadow: active ? "0 6px 14px rgba(0,194,238,0.25)" : "none" }}>
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="cw-caption" style={{ marginBottom: 22, color: SURFACES.inkSoft }}>
            Each turn is always 1 minute with a ring countdown. The overall game lasts {gameTimeMinutes} minutes.
          </div>

          <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
            <PrimaryPillButton label={actionBusy ? "CREATING..." : "CREATE ROOM"} onClick={() => { if (actionBusy) return; setActionBusy(true); onCreate({ maxPlayers: playersCount, grid: gridChoice, shape: shapeChoice, gameTimeMinutes, teamMode }); setTimeout(() => setActionBusy(false), 1500); }} disabled={!connected || actionBusy} />
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
          <div style={{ width: "100%", maxWidth: 320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            <PrimaryPillButton
              label={actionBusy ? "JOINING..." : "JOIN ROOM"}
              onClick={() => { if (actionBusy) return; setActionBusy(true); onJoin(); setTimeout(() => setActionBusy(false), 1200); }}
              disabled={!canJoin || actionBusy}
            />
            <button
              onClick={() => { if (actionBusy) return; setActionBusy(true); onSpectate(); setTimeout(() => setActionBusy(false), 1200); }}
              disabled={!connected || code.length < 5 || actionBusy || !name.trim()}
              style={{ width: "100%", height: 50, borderRadius: 999, border: "3px dashed var(--cw-ink-soft)", background: "rgba(255,255,255,0.35)", color: SURFACES.ink, fontWeight: 700, fontSize: 16, cursor: (!connected || code.length < 5 || actionBusy || !name.trim()) ? "default" : "pointer", opacity: (!connected || code.length < 5 || actionBusy || !name.trim()) ? 0.6 : 1 }}
            >
              {actionBusy ? "Please wait…" : "Watch as spectator"}
            </button>
          </div>
          {!name.trim() && <div className="cw-caption" style={{ marginTop: 10, textAlign: "center" }}>Enter your name to join or spectate</div>}
          {!connected && <div className="cw-caption" style={{ marginTop: 10, textAlign: "center", color: "#FE6057" }}>Connecting to server…</div>}
        </div>
      </div>
    );
  }

  // landing
  return (
    <div className="cw-page-shell cw-no-scrollbar" style={{ background: "linear-gradient(180deg, #EAF6FF 0%, #FFF9EF 100%)", position: "relative", overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <CloudField />
      <div style={{ flex: "1 0 auto", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "max(16px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom))" }}>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }} style={{ position: "relative", zIndex: 1, textAlign: "center", width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div className="cw-display" style={{ color: SURFACES.plum, marginBottom: 4, fontSize: "clamp(40px, 11vw, 64px)", lineHeight: 0.95, textShadow: "0 4px 0 rgba(255,255,255,0.65)" }}>COLOR WARS</div>
          <div className="cw-body" style={{ color: SURFACES.ink, marginBottom: 12, fontWeight: 800, fontSize: "clamp(16px, 4.2vw, 18px)" }}>A multiplayer chain reaction game</div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "clamp(2px, 1.5vw, 10px)", flexWrap: "wrap", margin: "0 auto 14px", maxWidth: 360, width: "100%", filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.08))" }}>
            <div style={{ transform: "scale(0.72)", transformOrigin: "bottom center", margin: "0 -10px" }}><Mascot color="#ef4444" size="lg" state="entrance" animateKey={1} smile /></div>
            <div style={{ transform: "scale(0.72)", transformOrigin: "bottom center", margin: "0 -10px" }}><Mascot color="#3b82f6" size="lg" state="entrance" animateKey={2} smile /></div>
            <div style={{ transform: "scale(0.72)", transformOrigin: "bottom center", margin: "0 -10px" }}><Mascot color="#22c55e" size="lg" state="entrance" animateKey={3} smile /></div>
            <div style={{ transform: "scale(0.72)", transformOrigin: "bottom center", margin: "0 -10px" }}><Mascot color="#eab308" size="lg" state="entrance" animateKey={4} smile /></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <PrimaryPillButton label="VS COMPUTER" onClick={() => { play("ui.tap"); setView("single"); }} />
            <IconButton variant="navy" icon="help" ariaLabel="How to play" onClick={() => { play("ui.tap"); setView("howto"); }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", width: "100%" }}>
            <button onClick={() => { play("ui.tap"); setView("create"); }} style={{ width: "min(100%, 300px)", height: 52, padding: "0 24px", borderRadius: 999, border: "2px solid rgba(66,50,76,0.16)", background: "rgba(255,255,255,0.72)", color: SURFACES.ink, fontWeight: 800, fontSize: 17, cursor: "pointer", boxShadow: "0 6px 14px rgba(0,0,0,0.05)" }}>Create online room</button>
            <button onClick={() => { play("ui.tap"); setView("join"); }} style={{ width: "min(100%, 300px)", height: 52, padding: "0 24px", borderRadius: 999, border: "2px solid rgba(66,50,76,0.16)", background: "rgba(255,255,255,0.72)", color: SURFACES.ink, fontWeight: 800, fontSize: 17, cursor: "pointer", boxShadow: "0 6px 14px rgba(0,0,0,0.05)" }}>Join room</button>
          </div>
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <IconButton variant="ghost" icon={settings.muted ? "speaker-off" : "speaker-on"} ariaLabel="Sound" onClick={() => { setMuted(!settings.muted); play("ui.tap"); }} />
            <IconButton variant="ghost" icon="gear" ariaLabel="Settings" onClick={() => { play("ui.tap"); onOpenSettings(); }} />
          </div>
          {!connected && <div className="cw-caption" style={{ marginTop: 8, color: SURFACES.inkSoft }}>Connecting for online play…</div>}
          <div className="cw-caption" style={{ marginTop: 10, color: SURFACES.inkSoft }}>
            created by <a href="https://nextpointer.dev" target="_blank" rel="noopener noreferrer" style={{ color: SURFACES.plum, fontWeight: 800, textDecoration: "none" }}>nextpointer</a>
          </div>
        </motion.div>
      </div>
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Settings">
        <SettingsRows />
      </Modal>
    </div>
  );
}

export function SettingsRows() {
  const { settings, setMuted, setHaptics, setAnimationQuality, setTimerSounds } = useSettings();
  const row = (label: string, right: React.ReactNode, hint?: string) => (
    <div style={{ padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div className="cw-body" style={{ color: SURFACES.ink }}>{label}</div>{right}
      </div>
      {hint ? <div className="cw-caption" style={{ marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
  const toggle = (on: boolean, set: (v:boolean)=>void) => (
    <button onClick={() => { set(!on); play("ui.tap"); }} style={{ width: 56, height: 32, borderRadius: 999, border: "none", background: on ? SURFACES.action : SURFACES.pill, position: "relative", cursor: "pointer", flex: "0 0 auto" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 27 : 3, width: 26, height: 26, borderRadius: "50%", background: SURFACES.cloud, transition: "left 150ms" }} />
    </button>
  );
  const seg = (opts: {id:string;label:string}[], value: string, set: (v:any)=>void) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
      {opts.map(o => {
        const active = o.id === value;
        return <button key={o.id} onClick={() => { set(o.id); play("ui.tap"); }} style={{ height: 32, padding: "0 10px", borderRadius: 999, border: "none", fontWeight: 800, fontSize: 12, cursor: "pointer", background: active ? SURFACES.action : SURFACES.cloud, color: active ? SURFACES.whiteText : SURFACES.ink }}>{o.label}</button>;
      })}
    </div>
  );
  return (
    <div>
      {row("Sound", toggle(!settings.muted, (v)=>setMuted(!v)))}
      {row("Haptics", toggle(settings.haptics, setHaptics))}
      {row("Timer sounds", toggle(settings.timerSounds, setTimerSounds), "Ticks and alerts in the last seconds of each 1-minute turn")}
      {row("Animations", seg([{id:"full",label:"Full"},{id:"reduced",label:"Reduced"},{id:"minimal",label:"Minimal"}], settings.animationQuality, setAnimationQuality), "Reduce or simplify chain animations for performance")}
      <div style={{ padding: "12px 0" }} className="cw-caption">Drop dots, grow your cells, pop chains, and own the board!</div>
      <div className="cw-caption">Play vs computer or online with friends.</div>
      <div className="cw-caption" style={{ marginTop: 4 }}>v1.0.0</div>
    </div>
  );
}
