import React, { useMemo, useRef } from "react";
import type { GameState } from "@game/shared";
import { ScorePill } from "../design/ScorePill";
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
}) {
  const { state, playerId, myTurn, chainLocked, flightRef, bumpKeys, onMove, onQuit, onOpenSettings, onMetrics } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width: vw, height: vh, forceLandscape } = useViewport();
  const n = state.players.length;
  const landscape = vw >= vh;
  const compactPills = n >= 5;
  const reserve: Reserve = useMemo(() => {
    if (forceLandscape || landscape) return { top: 8, bottom: 8, left: 76, right: 8 };
    return { top: 56, bottom: 60, left: 8, right: 8 };
  }, [vw, vh, forceLandscape, landscape, compactPills]);
  const { metrics } = useBoardMetrics(containerRef, state.rows, state.cols, reserve);
  const current = state.players[state.currentPlayerIndex];
  const curSeat = current ? vis(current) : visualsForPlayer("#00C2EE", 0);

  const scores = state.players.map(p => ({ p, score: orbTotal(state, p.id), seat: vis(p) }));
  const showTopBottom = !(forceLandscape || landscape);
  const topPills = showTopBottom ? scores.slice(0, Math.ceil(n/2)) : [];
  const bottomPills = showTopBottom ? scores.slice(Math.ceil(n/2)) : [];

  const renderPill = (s: {p:any;score:number;seat:any}, _i:number, edge:"top"|"bottom"|"left") => {
    const active = s.p.id === current?.id;
    return (
      <ScorePill key={s.p.id} score={s.score} color={s.seat.base} seatIndex={s.p.id} active={active && !chainLocked}
        tucked={false} ghosted={!s.p.alive} compact={true} name={s.p.name} bumpKey={bumpKeys[s.p.id]||0} tuckDirection={edge === "top" ? "up" : edge === "bottom" ? "down" : "right"} />
    );
  };

  const boardW = state.cols * metrics.cell + Math.max(0, state.cols - 1) * metrics.gap;
  const boardH = state.rows * metrics.cell + Math.max(0, state.rows - 1) * metrics.gap;

  return (
    <div ref={containerRef} className="cw-page-shell cw-game-surface" style={{ background: curSeat.turnBg, transition: "background 450ms ease-in-out", height: "100%", overflow: "hidden", position: "relative" }}>
      {(forceLandscape || landscape) ? (
        <div style={{ position: "absolute", top: 4, left: 4, bottom: 4, width: 72, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, zIndex: Z.hud, pointerEvents: "none", overflow: "hidden" }}>
          {scores.map((s)=>renderPill(s,0,"left"))}
        </div>
      ) : (
        <>
          <div style={{ position: "absolute", top: 4, left: 4, right: 4, display: "flex", justifyContent: "center", gap: 6, zIndex: Z.hud, flexWrap: "wrap", pointerEvents: "none" }}>
            {topPills.map((s,i)=>renderPill(s,i,"top"))}
          </div>
          <div style={{ position: "absolute", bottom: 4, left: 4, right: 4, display: "flex", justifyContent: "center", gap: 6, zIndex: Z.hud, flexWrap: "wrap", pointerEvents: "none" }}>
            {bottomPills.map((s,i)=>renderPill(s,i,"bottom"))}
          </div>
        </>
      )}

      <div className="cw-no-scrollbar" style={{ position: "absolute", inset: 0, overflow: "auto", WebkitOverflowScrolling: "touch", paddingTop: reserve.top, paddingBottom: reserve.bottom, paddingLeft: reserve.left, paddingRight: reserve.right }}>
        <div style={{ minWidth: "100%", minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "relative", width: boardW, height: boardH, margin: "auto" }}>
            <SvgBoard state={state} playerId={playerId} metrics={metrics} myTurn={myTurn} chainLocked={chainLocked} onMove={onMove} flightRef={flightRef} onMetrics={onMetrics} />
          </div>
        </div>
      </div>

      {current && !chainLocked && (
        <div style={{ position: "absolute", right: 8, top: showTopBottom ? "calc(env(safe-area-inset-top) + 52px)" : "8px", zIndex: Z.hud, pointerEvents: "none", background: curSeat.fan, color: "#fff", borderRadius: 999, padding: "8px 12px", fontWeight: 800, fontSize: 14, maxWidth: showTopBottom ? "calc(100% - 80px)" : "none" }} className="cw-truncate">
          {current.id === playerId ? "Your turn" : `${current.name}'s turn`}
        </div>
      )}

      <div style={{ position: "absolute", left: 8, top: showTopBottom ? "calc(env(safe-area-inset-top) + 48px)" : "8px", zIndex: Z.hud + 1 }}>
        <IconButton variant="ghost" icon="gear" ariaLabel="Settings" onClick={() => { void play("ui.tap"); onOpenSettings(); }} />
      </div>

      <div style={{ position: "absolute", bottom: `calc(env(safe-area-inset-bottom) + 10px)`, left: "50%", transform: "translateX(-50%)", zIndex: Z.hud + 1 }}>
        <QuitButton onClick={onQuit} />
      </div>
    </div>
  );
}