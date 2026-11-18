import React, { useMemo, useRef } from "react";
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
import { play } from "../design/sound";

function vis(p: {id:number;color:string}) { return visualsForPlayer(p.color, p.id); }
function orbTotal(state: GameState, pid: number) {
  let n = 0; for (const row of state.board) for (const cell of row) if (cell.owner === pid) n += cell.count; return n;
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
}) {
  const { state, playerId, myTurn, chainLocked, flightRef, bumpKeys, onMove, onQuit, onOpenSettings, onMetrics, playersConn, myRtt, myQuality } = props;
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
  const curSeat = current ? vis(current) : visualsForPlayer("#00C2EE", 0);

  const scores = state.players.map(p => ({ p, score: orbTotal(state, p.id), seat: vis(p) }));

  const renderPill = (s: {p:any;score:number;seat:any}, edge:"top"|"left") => {
    const active = s.p.id === current?.id;
    const isMe = s.p.id === playerId;
    const conn = isMe ? { connected: true, quality: myQuality || "good" } : playersConn?.[s.p.id];
    const isOffline = !isMe && (conn?.connected === false || conn?.quality === "offline");
    const statusLabel = isOffline ? (!s.p.alive ? "Left" : "Offline") : null;
    return (
      <ScorePill key={s.p.id} score={s.score} color={s.seat.base} seatIndex={s.p.id} active={active && !chainLocked}
        tucked={false} ghosted={!s.p.alive} compact={true} name={s.p.name} bumpKey={bumpKeys[s.p.id]||0} tuckDirection={edge === "top" ? "up" : "right"}
        connQuality={conn?.quality} pingMs={isMe ? (myRtt ?? null) : null} isMe={isMe} statusLabel={statusLabel} showMyPing={false} />
    );
  };

  const boardW = state.cols * metrics.cell + Math.max(0, state.cols - 1) * metrics.gap;
  const boardH = state.rows * metrics.cell + Math.max(0, state.rows - 1) * metrics.gap;

  return (
    <div ref={containerRef} className="cw-page-shell cw-game-surface" style={{ background: curSeat.turnBg, transition: "background 450ms ease-in-out", height: "100%", overflow: "hidden", position: "relative" }}>
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

      {current && !chainLocked && (
        <div style={{ position: "absolute", right: 8, top: phonePortrait ? `calc(env(safe-area-inset-top) + ${Math.max(58, reserve.top - 6)}px)` : "8px", zIndex: Z.hud, pointerEvents: "none", background: curSeat.fan, color: "#fff", borderRadius: 999, padding: "8px 12px", fontWeight: 800, fontSize: 14, maxWidth: phonePortrait ? "calc(100% - 16px)" : "none" }} className="cw-truncate">
          {current.id === playerId ? "Your turn" : `${current.name}'s turn`}
        </div>
      )}

      {(() => {
        const q = myQuality || "good";
        const dot = q === "good" ? "#22c55e" : q === "ok" ? "#eab308" : q === "bad" ? "#ef4444" : "#6b7280";
        const label = myRtt != null ? `${myRtt}ms` : (q === "offline" ? "offline" : "…");
        const badge = (
          <div title={`Connection: ${q}${myRtt != null ? ` (${myRtt}ms)` : ""}`} aria-label={`Connection ${q} ${label}`}
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