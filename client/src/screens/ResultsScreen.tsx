import React, { useEffect } from "react";
import { motion } from "motion/react";
import type { GameState } from "@game/shared";
import { CloudField } from "../design/BackdropDecor";
import { Mascot } from "../design/Mascot";
import { PrimaryPillButton } from "../design/PrimaryPillButton";
import { SURFACES, visualsForPlayer } from "../design/tokens";
import { play } from "../design/sound";

function seatOf(p: { id: number; color: string }) { return visualsForPlayer(p.color, p.id); }
function orbTotal(state: GameState, pid: number) {
  let n = 0; for (const row of state.board) for (const cell of row) if (cell.owner === pid) n += cell.count; return n;
}

export function ResultsScreen(props: {
  state: GameState; playerId: number; hostId: number | null;
  onRematch: () => void; onLobby: () => void;
  localMode?: boolean;
  difficultyLabel?: string;
  spectator?: boolean;
}) {
  const { state, playerId, hostId, onRematch, onLobby, localMode = false, difficultyLabel, spectator = false } = props;
  const winner = state.players.find(p => p.id === state.winner) || state.players[0];
  const winSeat = seatOf(winner);
  const isHost = !spectator && hostId === playerId;
  const teamModeOn = state.teamMode && state.teamMode !== "off";
  const winningTeam = teamModeOn && typeof (winner as any)?.team === "number" ? (winner as any).team as number : null;
  const ranked = [...state.players].sort((a, b) => {
    if (teamModeOn && winningTeam != null) {
      const aw = (a as any).team === winningTeam ? 1 : 0;
      const bw = (b as any).team === winningTeam ? 1 : 0;
      if (bw !== aw) return bw - aw;
    }
    return (b.id === state.winner ? 1 : 0) - (a.id === state.winner ? 1 : 0) || orbTotal(state, b.id) - orbTotal(state, a.id);
  });

  useEffect(() => {
    if (!spectator && playerId === state.winner) void play("win.fanfare");
    else if (!spectator) void play("lose.wah");
  }, [playerId, state.winner, spectator]);

  const heading = localMode ? "Play again?" : "Back to lobby for a rematch?";
  const rematchLabel = localMode ? "PLAY AGAIN" : "BACK TO LOBBY";
  const leaveLabel = localMode ? "HOME" : "LEAVE";
  const didIWin = !spectator && playerId === state.winner;

  return (
    <div
      className="cw-no-scrollbar"
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: `linear-gradient(180deg, ${winSeat.turnBg} 0%, ${winSeat.fan} 45%, #FFF6E8 100%)`,
        overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch",
        padding: "max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))",
      }}
      data-testid="results-screen"
      data-winner-id={state.winner ?? ""}
      data-team-mode={state.teamMode || "off"}
    >
      <CloudField />
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", width: 280, height: 280, borderRadius: "50%", background: `${winSeat.base}22`, top: -80, right: -60, filter: "blur(8px)" }} />
        <div style={{ position: "absolute", width: 220, height: 220, borderRadius: "50%", background: "rgba(255,255,255,0.35)", bottom: 80, left: -50, filter: "blur(6px)" }} />
      </div>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} style={{ position: "relative", zIndex: 1, textAlign: "center", width: "100%", maxWidth: 540, margin: "0 auto", minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.05, duration: 0.35 }} style={{ marginBottom: 10 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, background: "#FFFFFF", border: "1px solid rgba(66,50,76,0.08)", boxShadow: "0 6px 16px rgba(0,0,0,0.06)", marginBottom: 10 }}>
            <span style={{ fontSize: 14 }} aria-hidden>🏁</span>
            <span className="cw-caption" style={{ color: SURFACES.ink, fontWeight: 800, letterSpacing: 0.4 }}>GAME OVER</span>
          </div>
          <div className="cw-display" style={{ color: SURFACES.plum, fontSize: "clamp(30px, 8vw, 44px)", lineHeight: 1.05, textShadow: "0 3px 0 rgba(255,255,255,0.6)" }}>
            {teamModeOn && winningTeam != null ? `Team ${winningTeam + 1} wins!` : `${winner.name} wins!`}
          </div>
          {!spectator && (
            <div className="cw-body" style={{ color: SURFACES.inkSoft, marginTop: 6, fontWeight: 700 }}>
              {didIWin ? "Amazing moves — you conquered the board!" : "Good game! Ready for another round?"}
            </div>
          )}
        </motion.div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "clamp(8px, 3vw, 18px)", margin: "8px 0 18px", minHeight: 190, flexWrap: "wrap" }}>
          {ranked[1] && (
            <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.12 }} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: 18, marginBottom: 2, opacity: 0.9 }}>🥈</div>
              <Mascot color={seatOf(ranked[1]).base} size="lg" state="entrance" animateKey={2} smile />
              <div className="cw-truncate" style={{ marginTop: 8, maxWidth: 120, background: "#FFFFFF", border: "1px solid rgba(66,50,76,0.08)", color: SURFACES.ink, borderRadius: 999, padding: "5px 10px", fontWeight: 800, fontSize: 14, boxShadow: "0 4px 10px rgba(0,0,0,0.06)" }}>{ranked[1].name}</div>
            </motion.div>
          )}
          <motion.div initial={{ y: 8, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ delay: 0.06 }} style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 30, marginBottom: 2, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.12))" }}>👑</div>
            <Mascot color={winSeat.base} size="lg" state="cheer" animateKey={1} smile />
            <div className="cw-truncate" style={{ marginTop: 8, maxWidth: 240, background: winSeat.base, color: "#fff", borderRadius: 999, padding: "7px 16px", fontWeight: 900, fontSize: 16, boxShadow: "0 8px 18px rgba(0,0,0,0.14)" }}>
              {teamModeOn && winningTeam != null ? `Team ${winningTeam + 1}` : winner.name}
            </div>
          </motion.div>
          {ranked[2] && (
            <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.18 }} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: 18, marginBottom: 2, opacity: 0.9 }}>🥉</div>
              <Mascot color={seatOf(ranked[2]).base} size="lg" state="entrance" animateKey={3} smile />
              <div className="cw-truncate" style={{ marginTop: 8, maxWidth: 120, background: "#FFFFFF", border: "1px solid rgba(66,50,76,0.08)", color: SURFACES.ink, borderRadius: 999, padding: "5px 10px", fontWeight: 800, fontSize: 14, boxShadow: "0 4px 10px rgba(0,0,0,0.06)" }}>{ranked[2].name}</div>
            </motion.div>
          )}
        </div>

        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.12 }} style={{ background: "#FFFFFF", border: "1px solid rgba(66,50,76,0.08)", borderRadius: 22, padding: 12, marginBottom: 18, textAlign: "left", boxShadow: "0 10px 24px rgba(0,0,0,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 8px 8px", marginBottom: 4, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
            <span className="cw-caption" style={{ color: SURFACES.inkSoft, fontWeight: 800, letterSpacing: 0.6 }}>FINAL STANDINGS</span>
            {localMode && difficultyLabel ? <span className="cw-caption" style={{ color: SURFACES.inkSoft }}>Vs Computer · {difficultyLabel}</span> : null}
            {!localMode && state.gameTimeMinutes ? <span className="cw-caption" style={{ color: SURFACES.inkSoft }}>{state.gameTimeMinutes} min game</span> : null}
          </div>
          {ranked.map((p, idx) => {
            const isWinner = p.id === state.winner;
            const pSeat = seatOf(p);
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 8px", gap: 8, borderRadius: 14, background: isWinner ? `${pSeat.base}18` : "transparent", marginTop: idx === 0 ? 2 : 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ width: 26, height: 26, borderRadius: "50%", background: isWinner ? pSeat.base : "rgba(0,0,0,0.08)", color: isWinner ? "#fff" : SURFACES.ink, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13, flex: "0 0 auto" }}>{idx + 1}</span>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: pSeat.base, boxShadow: `0 0 0 3px ${pSeat.base}33`, flex: "0 0 auto" }} />
                  <span className="cw-body cw-truncate" style={{ color: SURFACES.ink, fontWeight: isWinner ? 800 : 700 }}>
                    {p.name}{p.id === playerId ? " (you)" : ""}{teamModeOn && typeof (p as any).team === "number" ? ` · T${((p as any).team as number) + 1}` : ""}
                  </span>
                </div>
                <span className="cw-caption" style={{ flex: "0 0 auto", color: SURFACES.inkSoft, fontWeight: 700 }}>{p.alive ? `${orbTotal(state, p.id)} dots` : "Eliminated"}</span>
              </div>
            );
          })}
        </motion.div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", width: "100%" }}>
          <div className="cw-body" style={{ color: SURFACES.ink, marginBottom: 2, fontWeight: 700 }}>{spectator ? "You watched this match as a spectator" : heading}</div>
          {!spectator && (localMode || isHost) ? (
            <PrimaryPillButton label={rematchLabel} onClick={onRematch} />
          ) : !spectator ? (
            <>
              <div style={{ width: "min(100%, 280px)", height: 54, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px", borderRadius: 999, background: "#FFFFFF", border: "1px solid rgba(66,50,76,0.10)", color: SURFACES.ink, fontWeight: 800, fontSize: 17, boxShadow: "0 6px 14px rgba(0,0,0,0.06)" }}>
                Waiting for host…
              </div>
              <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>Host can take everyone back to the lobby</div>
            </>
          ) : null}
          <button onClick={onLobby} style={{ width: "min(100%, 280px)", height: 54, padding: "0 24px", borderRadius: 999, border: "2px solid rgba(66,50,76,0.2)", background: "#FFFFFF", color: SURFACES.ink, fontWeight: 800, fontSize: 17, cursor: "pointer", boxShadow: "0 6px 14px rgba(0,0,0,0.05)" }}>{leaveLabel}</button>
        </div>
      </motion.div>
    </div>
  );
}
