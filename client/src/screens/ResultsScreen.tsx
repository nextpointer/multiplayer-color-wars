import React, { useEffect } from "react";
import { motion } from "motion/react";
import type { GameState } from "@game/shared";
import { CloudField } from "../design/BackdropDecor";
import { Mascot } from "../design/Mascot";
import { PrimaryPillButton } from "../design/PrimaryPillButton";
import { SURFACES, visualsForPlayer } from "../design/tokens";
import { play } from "../design/sound";

function seatOf(p:{id:number;color:string}){ return visualsForPlayer(p.color, p.id); }
function orbTotal(state: GameState, pid: number) {
  let n = 0; for (const row of state.board) for (const cell of row) if (cell.owner === pid) n += cell.count; return n;
}

export function ResultsScreen(props: {
  state: GameState; playerId: number; hostId: number | null;
  onRematch: () => void; onLobby: () => void;
  localMode?: boolean;
  difficultyLabel?: string;
}) {
  const { state, playerId, hostId, onRematch, onLobby, localMode = false, difficultyLabel } = props;
  const winner = state.players.find(p => p.id === state.winner) || state.players[0];
  const winSeat = seatOf(winner);
  const isHost = hostId === playerId;
  const ranked = [...state.players].sort((a,b) => (b.id===state.winner?1:0)-(a.id===state.winner?1:0) || orbTotal(state,b.id)-orbTotal(state,a.id));

  useEffect(() => {
    if (playerId === state.winner) void play("win.fanfare"); else void play("lose.wah");
  }, [playerId, state.winner]);

  const heading = localMode ? "Play again?" : "Play again in the same room?";
  const rematchLabel = localMode ? "PLAY AGAIN" : "BACK TO LOBBY";
  const leaveLabel = localMode ? "HOME" : "Leave";

  return (
    <div className="cw-no-scrollbar" style={{ position: "fixed", inset: 0, zIndex: 50, background: winSeat.turnBg, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", padding: "max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))" }}>
      <CloudField />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ position: "relative", zIndex: 1, textAlign: "center", width: "100%", maxWidth: 520, margin: "0 auto", minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "clamp(8px, 3vw, 16px)", marginBottom: 16, minHeight: 180, flexWrap: "wrap" }}>
          {ranked[1] && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <Mascot color={seatOf(ranked[1]).base} size="lg" state="entrance" animateKey={2} />
              <div className="cw-truncate" style={{ marginTop: 8, maxWidth: 110, background: SURFACES.pill, color: "#fff", borderRadius: 999, padding: "4px 10px", fontWeight: 700, fontSize: 14 }}>{ranked[1].name}</div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>👑</div>
            <Mascot color={winSeat.base} size="lg" state="cheer" animateKey={1} />
            <div className="cw-truncate" style={{ marginTop: 8, maxWidth: 180, background: winSeat.base, color: "#fff", borderRadius: 999, padding: "6px 14px", fontWeight: 800, fontSize: 15 }}>{winner.name} wins!</div>
          </div>
          {ranked[2] && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <Mascot color={seatOf(ranked[2]).base} size="lg" state="entrance" animateKey={3} />
              <div className="cw-truncate" style={{ marginTop: 8, maxWidth: 110, background: SURFACES.pill, color: "#fff", borderRadius: 999, padding: "4px 10px", fontWeight: 700, fontSize: 14 }}>{ranked[2].name}</div>
            </div>
          )}
        </div>
        <div style={{ background: "rgba(255,255,255,0.55)", borderRadius: 20, padding: 12, marginBottom: 18, textAlign: "left" }}>
          {localMode && difficultyLabel && (
            <div style={{ padding: "4px 8px 8px", marginBottom: 4, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <span className="cw-caption" style={{ color: SURFACES.inkSoft }}>Vs Computer · {difficultyLabel}</span>
            </div>
          )}
          {ranked.map((p, idx) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span className="cw-score" style={{ color: seatOf(p).base, fontSize: 18, minWidth: 20, flex: "0 0 auto" }}>{idx+1}</span>
                <span className="cw-body cw-truncate" style={{ color: SURFACES.ink }}>{p.name}{p.id===playerId?" (you)":""}</span>
              </div>
              <span className="cw-caption" style={{ flex: "0 0 auto" }}>{p.alive ? `${orbTotal(state,p.id)} dots` : "Eliminated"}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", width: "100%" }}>
          <div className="cw-body" style={{ color: SURFACES.ink, marginBottom: 2 }}>{heading}</div>
          {localMode || isHost ? (
            <PrimaryPillButton label={rematchLabel} onClick={onRematch} />
          ) : (
            <>
              <div style={{ width: "min(100%, 280px)", height: 54, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px", borderRadius: 999, background: "rgba(255,255,255,0.35)", color: SURFACES.ink, fontWeight: 700, fontSize: 17 }}>
                Waiting for host…
              </div>
              <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>Host can take everyone back to the lobby</div>
            </>
          )}
          <button onClick={onLobby} style={{ width: "min(100%, 280px)", height: 54, padding: "0 24px", borderRadius: 999, border: "3px dashed var(--cw-ink-soft)", background: "rgba(255,255,255,0.25)", color: SURFACES.ink, fontWeight: 700, fontSize: 17, cursor: "pointer" }}>{leaveLabel}</button>
        </div>
      </motion.div>
    </div>
  );
}
