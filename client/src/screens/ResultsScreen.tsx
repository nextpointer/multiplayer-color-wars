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
}) {
  const { state, playerId, hostId, onRematch, onLobby } = props;
  const winner = state.players.find(p => p.id === state.winner) || state.players[0];
  const winSeat = seatOf(winner);
  const isHost = hostId === playerId;
  const ranked = [...state.players].sort((a,b) => (b.id===state.winner?1:0)-(a.id===state.winner?1:0) || orbTotal(state,b.id)-orbTotal(state,a.id));

  useEffect(() => {
    if (playerId === state.winner) void play("win.fanfare"); else void play("lose.wah");
  }, [playerId, state.winner]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: winSeat.turnBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, overflow: "hidden" }}>
      <CloudField />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ position: "relative", zIndex: 1, textAlign: "center", width: "100%", maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 16, marginBottom: 20, height: 220 }}>
          {ranked[1] && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <Mascot color={seatOf(ranked[1]).base} size="lg" state="entrance" animateKey={2} />
              <div style={{ marginTop: 8, background: SURFACES.pill, color: "#fff", borderRadius: 999, padding: "4px 10px", fontWeight: 700, fontSize: 14 }}>{ranked[1].name}</div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>👑</div>
            <Mascot color={winSeat.base} size="lg" state="cheer" animateKey={1} />
            <div style={{ marginTop: 8, background: winSeat.base, color: "#fff", borderRadius: 999, padding: "6px 14px", fontWeight: 800, fontSize: 15 }}>{winner.name} wins!</div>
          </div>
          {ranked[2] && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <Mascot color={seatOf(ranked[2]).base} size="lg" state="entrance" animateKey={3} />
              <div style={{ marginTop: 8, background: SURFACES.pill, color: "#fff", borderRadius: 999, padding: "4px 10px", fontWeight: 700, fontSize: 14 }}>{ranked[2].name}</div>
            </div>
          )}
        </div>
        <div style={{ background: "rgba(255,255,255,0.5)", borderRadius: 20, padding: 12, marginBottom: 20 }}>
          {ranked.map((p, idx) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="cw-score" style={{ color: seatOf(p).base, fontSize: 18, minWidth: 20 }}>{idx+1}</span>
                <span className="cw-body" style={{ color: SURFACES.ink }}>{p.name}{p.id===playerId?" (you)":""}</span>
              </div>
              <span className="cw-caption">{p.alive ? `${orbTotal(state,p.id)} dots` : "Eliminated"}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <div className="cw-body" style={{ color: SURFACES.ink, marginBottom: 4 }}>Rematch?</div>
          {isHost ? (
            <PrimaryPillButton label="REMATCH" onClick={onRematch} />
          ) : (
            <>
              <PrimaryPillButton label="REQUEST REMATCH" onClick={onRematch} />
              <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>Host can start the rematch</div>
            </>
          )}
          <button onClick={onLobby} style={{ height: 56, padding: "0 28px", borderRadius: 999, border: "3px dashed var(--cw-ink-soft)", background: "transparent", color: SURFACES.ink, fontWeight: 700, fontSize: 17, cursor: "pointer" }}>Lobby</button>
        </div>
      </motion.div>
    </div>
  );
}
