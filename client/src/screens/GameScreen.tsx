import React, { useEffect, useMemo, useRef } from "react";
import type { GameState } from "@game/shared";
import { ScorePill, type ConnQuality } from "../design/ScorePill";
import { QuitButton } from "../design/QuitButton";
import { IconButton } from "../design/IconButton";
import { Z, visualsForPlayer } from "../design/tokens";
import { useBoardMetrics, type Reserve } from "../design/useBoardMetrics";
import { useViewport } from "../design/useViewport";
import { SvgBoard } from "../design/SvgBoard";
import type { SvgFlightEngineHandle } from "../engine/svgFlight";
import type { Settings } from "../state/settings";
import { haptic, play } from "../design/sound";

function vis(p: {id:number;color:string}) { return visualsForPlayer(p.color, p.id); }
function orbTotal(state: GameState, pid: number) {
  let n = 0; for (const row of state.board) for (const cell of row) if (cell.owner === pid) n += cell.count; return n;
}
function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function GameScreen(props: {
  state: GameState; serverState: GameState;
  roomId: string; playerId: number; hostId: number | null;
  myTurn: boolean; chainLocked: boolean;
  flightRef: React.RefObject<SvgFlightEngineHandle>;
  flashCells: Set<string>; nudgeKey: number; bumpKeys: Record<number,number>;
  onMove: (r:number,c:number)=>void; onQuit: ()=>void; onOpenSettings: ()=>void;
  onMetrics?: (m: { cell: number; gap: number }) => void;
  settings: Settings;
  playersConn?: Record<number, { connected: boolean; quality: ConnQuality }>;
  myRtt?: number | null;
  myQuality?: ConnQuality;
  connectionLabel?: string | null;
  tossHighlightPlayerId?: number | null;
  spectator?: boolean;
  spectatorsCount?: number;
}) {
  const { state, playerId, myTurn, chainLocked, flightRef, bumpKeys, onMove, onQuit, onOpenSettings, onMetrics, playersConn, myRtt, myQuality, connectionLabel, tossHighlightPlayerId, spectator = false, spectatorsCount = 0 } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width: vw, height: vh, forceLandscape } = useViewport();
  const landscape = vw >= vh;
  const phonePortrait = !forceLandscape && !landscape;
  const n = state.players.length;
  const compactPills = n >= 5;
  const reserve: Reserve = useMemo(() => {
    if (!phonePortrait) return { top: 8, bottom: 8, left: 76, right: 8 };
    const top = n <= 4 ? 64 : (n <= 6 ? 104 : 132);
    return { top, bottom: 78, left: 8, right: 8 };
  }, [phonePortrait, n]);
  const { metrics } = useBoardMetrics(containerRef, state.rows, state.cols, reserve);
  const current = state.players[state.currentPlayerIndex];
  const tossing = tossHighlightPlayerId != null;
  const highlightId = tossing ? tossHighlightPlayerId : current?.id;
  const highlightPlayer = state.players.find(p => p.id === highlightId) || current;
  const curSeat = highlightPlayer ? vis(highlightPlayer) : visualsForPlayer("#00C2EE", 0);
  // Keep background stable during toss to avoid eye-hurting color shifts.
  const bgSeat = current ? vis(current) : curSeat;

  const [gameTimeLeftMs, setGameTimeLeftMs] = React.useState<number | null>(null);
  const [, forceTick] = React.useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (state.status !== "playing") { setGameTimeLeftMs(null); return; }
    let raf = 0;
    const tick = () => {
      if (state.gameDeadline) setGameTimeLeftMs(Math.max(0, state.gameDeadline - Date.now()));
      else setGameTimeLeftMs(null);
      forceTick(); // refresh turn badge seconds / rings
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [state.status, state.gameDeadline, state.turnDeadline, state.turnCount, state.currentPlayerIndex]);

  const scores = state.players.map(p => ({ p, score: orbTotal(state, p.id), seat: vis(p) }));

  const renderPill = (s: {p:any;score:number;seat:any}, edge:"top"|"left") => {
    const active = s.p.id === highlightId;
    const isMe = s.p.id === playerId;
    const conn = isMe ? { connected: true, quality: myQuality || "good" } : playersConn?.[s.p.id];
    const isOffline = !isMe && (conn?.connected === false || conn?.quality === "offline");
    const statusLabel = isOffline ? (!s.p.alive ? "Left" : "Offline") : null;
    const timerActive = !tossing && state.status === "playing" && s.p.id === current?.id && !chainLocked && !!state.turnDurationMs && !!state.turnDeadline;
    const teamLabel = state.teamMode && state.teamMode !== "off" && typeof s.p.team === "number" ? `T${s.p.team + 1}` : null;
    return (
      <ScorePill key={s.p.id} score={s.score} color={s.seat.base} seatIndex={s.p.id} active={active && (!chainLocked || tossing)}
        tucked={false} ghosted={!s.p.alive} compact={true} name={s.p.name} bumpKey={bumpKeys[s.p.id]||0} tuckDirection={edge === "top" ? "up" : "right"}
        connQuality={conn?.quality} pingMs={isMe ? (myRtt ?? null) : null} isMe={isMe} statusLabel={statusLabel} showMyPing={false}
        turnDurationMs={timerActive ? (state.turnDurationMs ?? null) : null}
        turnDeadline={timerActive ? (state.turnDeadline ?? null) : null}
        timerActive={timerActive} teamLabel={teamLabel} />
    );
  };

  const boardW = state.cols * metrics.cell + Math.max(0, state.cols - 1) * metrics.gap;
  const boardH = state.rows * metrics.cell + Math.max(0, state.rows - 1) * metrics.gap;
  const timerTickKeyRef = useRef<string | null>(null);

  useEffect(() => {
    timerTickKeyRef.current = null;
  }, [state.turnCount, state.currentPlayerIndex, state.status]);

  useEffect(() => {
    if (tossing || chainLocked) return;
    if (state.status !== "playing" || !state.turnDurationMs || !state.turnDeadline) return;
    if (!props.settings.timerSounds && !props.settings.haptics) return;
    const active = state.players[state.currentPlayerIndex];
    if (!active || !active.alive) return;
    const isMyTurn = active.id === playerId;
    let raf = 0;
    const tick = () => {
      const remainingMs = state.turnDeadline! - Date.now();
      const sec = Math.ceil(remainingMs / 1000);
      // tick in last 10 seconds, urgent in last 5 (and for my turn be a bit stronger)
      if (sec <= 10 && sec >= 1) {
        const key = `${state.turnCount}:${state.currentPlayerIndex}:${sec}`;
        if (timerTickKeyRef.current !== key) {
          timerTickKeyRef.current = key;
          if (props.settings.timerSounds) {
            void play(sec <= 3 ? "timer.urgent" : "timer.tick");
          }
          if (props.settings.haptics && (sec <= 5 || isMyTurn)) {
            haptic(sec <= 3 ? "medium" : "light");
          }
        }
      }
      if (remainingMs > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.status, state.turnDeadline, state.turnDurationMs, state.turnCount, state.currentPlayerIndex, tossing, chainLocked, playerId, props.settings.timerSounds, props.settings.haptics]);

  return (
    <div
      ref={containerRef}
      className="cw-page-shell cw-game-surface"
      style={{ background: tossing ? bgSeat.turnBg : curSeat.turnBg, transition: tossing ? "none" : "background 450ms ease-in-out", height: "100%", overflow: "hidden", position: "relative" }}
      data-testid="game-screen"
      data-spectator={spectator ? "true" : "false"}
      data-my-turn={myTurn ? "true" : "false"}
      data-current-player-id={current?.id ?? ""}
      data-current-player-name={current?.name ?? ""}
      data-turn-count={state.turnCount}
      data-game-status={state.status}
    >
      {!phonePortrait ? (
        <div style={{ position: "absolute", top: 4, left: 4, bottom: 4, width: 72, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, zIndex: Z.hud, pointerEvents: "none", overflow: "hidden" }}>
          {scores.map((s)=>renderPill(s,"left"))}
        </div>
      ) : (
        <div style={{ position: "absolute", top: "max(4px, env(safe-area-inset-top))", left: 6, right: 6, display: "flex", justifyContent: "center", gap: 6, zIndex: Z.hud, flexWrap: "wrap", pointerEvents: "none" }}>
          {scores.map((s)=>renderPill(s,"top"))}
        </div>
      )}

      <div className="cw-no-scrollbar" style={{ position: "absolute", inset: 0, overflow: "auto", WebkitOverflowScrolling: "touch", paddingTop: reserve.top, paddingBottom: reserve.bottom, paddingLeft: reserve.left, paddingRight: reserve.right }}>
        <div style={{ minWidth: "100%", minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "relative", width: boardW, height: boardH, margin: "auto" }}>
            <SvgBoard state={state} playerId={playerId} metrics={metrics} myTurn={myTurn} chainLocked={chainLocked} onMove={onMove} flightRef={flightRef} onMetrics={onMetrics} />
          </div>
        </div>
      </div>

      {(() => {
        const turnRemainingSec = (!tossing && state.status === "playing" && state.turnDeadline) ? Math.max(0, Math.ceil((state.turnDeadline - Date.now()) / 1000)) : null;
        const turnBadge = (tossing || (current && !chainLocked)) ? (
          <div data-testid="turn-indicator" style={{ background: tossing ? bgSeat.fan : curSeat.fan, color: "#fff", borderRadius: 999, padding: "8px 12px", fontWeight: 800, fontSize: 14, maxWidth: "100%", boxShadow: "0 4px 14px rgba(0,0,0,0.12)", display: "inline-flex", alignItems: "center", gap: 8 }} className="cw-truncate">
            <span className="cw-truncate">{tossing ? "Color toss…" : spectator ? `${current!.name}'s turn` : (current!.id === playerId ? "Your turn" : `${current!.name}'s turn`)}</span>
            {turnRemainingSec != null && !tossing ? <span style={{ background: "rgba(255,255,255,0.22)", borderRadius: 999, padding: "2px 8px", fontSize: 12, fontWeight: 900, flex: "0 0 auto" }}>{turnRemainingSec}s</span> : null}
          </div>
        ) : null;
        const spectatorBadge = spectatorsCount > 0 ? (
          <div data-testid="spectators-indicator" style={{ background: "rgba(47,51,62,0.92)", color: "#fff", borderRadius: 999, padding: "6px 10px", fontWeight: 800, fontSize: 12, maxWidth: "100%", display: "inline-flex", alignItems: "center", gap: 6, boxShadow: "0 4px 14px rgba(0,0,0,0.12)" }} className="cw-truncate">
            <span aria-hidden>👀</span>
            <span>{spectatorsCount} watching{spectator ? " · you are spectating" : ""}</span>
          </div>
        ) : (spectator ? (
          <div data-testid="spectators-indicator" style={{ background: "rgba(47,51,62,0.92)", color: "#fff", borderRadius: 999, padding: "6px 10px", fontWeight: 800, fontSize: 12, maxWidth: "100%", boxShadow: "0 4px 14px rgba(0,0,0,0.12)" }} className="cw-truncate">
            Watching as spectator
          </div>
        ) : null);
        const gameTimerBadge = (state.status === "playing" && gameTimeLeftMs != null) ? (
          <div data-testid="game-timer" title="Overall game time remaining" style={{ background: "rgba(255,255,255,0.92)", color: "#2A2E39", borderRadius: 999, padding: "6px 10px", fontWeight: 900, fontSize: 12, maxWidth: "100%", display: "inline-flex", alignItems: "center", gap: 6, boxShadow: "0 4px 14px rgba(0,0,0,0.10)", border: "1px solid rgba(255,255,255,0.8)" }}>
            <span aria-hidden>⏳</span>
            <span>{formatClock(gameTimeLeftMs)}</span>
          </div>
        ) : null;

        if (phonePortrait) {
          return (turnBadge || spectatorBadge || gameTimerBadge) ? (
            <div style={{ position: "absolute", left: 8, right: 8, top: `calc(env(safe-area-inset-top) + ${Math.max(58, reserve.top - 6)}px)`, zIndex: Z.hud, pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              {turnBadge}
              {gameTimerBadge}
              {spectatorBadge}
            </div>
          ) : null;
        }
        return (
          <>
            {(turnBadge || gameTimerBadge) && (
              <div style={{ position: "absolute", right: 8, top: "8px", zIndex: Z.hud, pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, maxWidth: "calc(100% - 140px)" }}>
                {turnBadge}
                {gameTimerBadge}
              </div>
            )}
            {spectatorBadge && (
              <div style={{ position: "absolute", left: 84, top: gameTimerBadge || turnBadge ? "88px" : "48px", zIndex: Z.hud, pointerEvents: "none", maxWidth: "calc(100% - 120px)" }}>
                {spectatorBadge}
              </div>
            )}
          </>
        );
      })()}

      {(() => {
        const q = connectionLabel ? "good" : (myQuality || "good");
        const dot = q === "good" ? "#22c55e" : q === "ok" ? "#eab308" : q === "bad" ? "#ef4444" : "#6b7280";
        const label = connectionLabel ?? (myRtt != null ? `${myRtt}ms` : (q === "offline" ? "offline" : "…"));
        const title = connectionLabel ? connectionLabel : `Connection: ${q}${myRtt != null ? ` (${myRtt}ms)` : ""}`;
        const aria = connectionLabel ? connectionLabel : `Connection ${q} ${label}`;
        const badge = (
          <div title={title} aria-label={aria}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: "rgba(47,51,62,0.88)", color: "#fff", fontSize: 12, fontWeight: 800, boxShadow: `0 0 0 2px ${dot}55` }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, boxShadow: `0 0 0 2px ${dot}33` }} />
            <span>{label}</span>
          </div>
        );
        if (phonePortrait) {
          return (
            <>
              <div style={{ position: "absolute", left: 12, bottom: `calc(env(safe-area-inset-bottom) + 76px)`, zIndex: Z.hud + 1 }}>
                {badge}
              </div>
              <div style={{ position: "absolute", left: 12, bottom: `calc(env(safe-area-inset-bottom) + 12px)`, zIndex: Z.hud + 1 }}>
                <IconButton variant="ghost" icon="gear" ariaLabel="Settings" onClick={() => { void play("ui.tap"); onOpenSettings(); }} />
              </div>
              <div style={{ position: "absolute", right: 12, bottom: `calc(env(safe-area-inset-bottom) + 12px)`, zIndex: Z.hud + 1 }}>
                <QuitButton onClick={onQuit} />
              </div>
            </>
          );
        }
        return (
          <>
            <div style={{ position: "absolute", left: 8, top: "8px", zIndex: Z.hud + 1, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
              <IconButton variant="ghost" icon="gear" ariaLabel="Settings" onClick={() => { void play("ui.tap"); onOpenSettings(); }} />
              {badge}
            </div>
            <div style={{ position: "absolute", bottom: `calc(env(safe-area-inset-bottom) + 10px)`, left: "50%", transform: "translateX(-50%)", zIndex: Z.hud + 1 }}>
              <QuitButton onClick={onQuit} />
            </div>
          </>
        );
      })()}
    </div>
  );
}