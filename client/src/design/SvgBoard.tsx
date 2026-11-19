import React, { useEffect } from "react";
import { motion } from "motion/react";
import { isPlayable, type GameState } from "@game/shared";
import { visualsForPlayer, cellHighlight } from "./tokens";
import { SLOTS, PIECE_R_F, DOT_R_F } from "../engine/geometry";
import { SPRING } from "./motion";
import { SvgFlightEngine, type SvgFlightEngineHandle } from "../engine/svgFlight";

function centerOf(r: number, c: number, cell: number, gap: number) {
  return { x: c * (cell + gap) + cell / 2, y: r * (cell + gap) + cell / 2 };
}

/** Dots are springy: existing dots shuffle between slots on every count change;
 *  freshly mounted dots (the one that just arrived/landed) pop from the center. */
function PieceDots({ cx, cy, cell, count, ghosted }: { cx: number; cy: number; cell: number; count: number; ghosted: boolean }) {
  const n = Math.max(0, Math.min(4, count));
  if (n === 0) return null;
  const slots = SLOTS[n as 1 | 2 | 3 | 4];
  const dotR = DOT_R_F * cell;
  return (
    <g opacity={ghosted ? 0.35 : 1}>
      {slots.slice(0, n).map((s, i) => (
        <motion.g
          key={i}
          initial={{ x: cx, y: cy, scale: 0.4 }}
          animate={{ x: cx + s.x * cell, y: cy + s.y * cell, scale: 1 }}
          transition={SPRING.settle}
        >
          <circle r={dotR} fill="#FFFFFF" opacity={ghosted ? 0.5 : 1} />
        </motion.g>
      ))}
    </g>
  );
}

export function SvgBoard(props: {
  state: GameState;
  playerId: number;
  metrics: { cell: number; gap: number; piece: number; dot: number };
  myTurn: boolean;
  chainLocked: boolean;
  onMove: (r: number, c: number) => void;
  flightRef: React.RefObject<SvgFlightEngineHandle>;
  onMetrics?: (m: { cell: number; gap: number }) => void;
}) {
  const { state, playerId, metrics, myTurn, chainLocked, onMove, flightRef, onMetrics } = props;
  useEffect(() => {
    onMetrics?.({ cell: metrics.cell, gap: metrics.gap });
  }, [metrics.cell, metrics.gap, onMetrics]);
  const boardW = state.cols * metrics.cell + Math.max(0, state.cols - 1) * metrics.gap;
  const boardH = state.rows * metrics.cell + Math.max(0, state.rows - 1) * metrics.gap;

  return (
    <svg
      width={boardW}
      height={boardH}
      viewBox={`0 0 ${boardW} ${boardH}`}
      style={{ overflow: "visible", display: "block", touchAction: "manipulation" }}
      shapeRendering="geometricPrecision"
      data-testid="game-board"
      data-rows={state.rows}
      data-cols={state.cols}
    >
      <defs>
        <filter id="blur-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        <filter id="blur-heavy" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <g>
        {Array.from({ length: state.rows }).map((_, r) =>
          Array.from({ length: state.cols }).map((__, c) => {
            if (!isPlayable(state, r, c)) return null;
            const cell = state.board[r][c];
            const { x, y } = centerOf(r, c, metrics.cell, metrics.gap);
            const owner = cell.owner != null ? state.players[cell.owner] : null;
            const seat = owner ? visualsForPlayer(owner.color, owner.id) : null;
            const me = state.players.find(p => p.id === playerId);
            const playable = myTurn && !chainLocked && (
              !me?.hasPlayed ? cell.owner === null : cell.owner === playerId
            );
            const fill = seat ? cellHighlight(seat.base) : "var(--cw-cell, #FCEDD0)";
            return (
              <g
                key={`c-${r}-${c}`}
                onClick={() => playable && onMove(r, c)}
                style={{ cursor: playable ? "pointer" : "default" }}
                data-testid={`cell-${r}-${c}`}
                data-cell={`${r}-${c}`}
                data-playable={playable ? "true" : "false"}
                data-owner={cell.owner == null ? "" : String(cell.owner)}
                data-count={cell.count}
              >
                <rect
                  x={c * (metrics.cell + metrics.gap)}
                  y={r * (metrics.cell + metrics.gap)}
                  width={metrics.cell}
                  height={metrics.cell}
                  rx={metrics.cell * 0.24}
                  fill={fill}
                  style={{ transition: "fill 220ms ease" }}
                />
                {cell.count > 0 && owner && seat && (
                  <g>
                    <circle cx={x} cy={y} r={PIECE_R_F * metrics.cell} fill={seat.base} opacity={!owner.alive ? 0.35 : 1} />
                    {cell.count === 3 && (
                      <circle cx={x} cy={y} r={PIECE_R_F * metrics.cell * 1.1} fill="none" stroke={seat.base} strokeWidth={2} opacity={!owner.alive ? 0.25 : 0.8} />
                    )}
                    <PieceDots cx={x} cy={y} cell={metrics.cell} count={cell.count} ghosted={!owner.alive} />
                  </g>
                )}
              </g>
            );
          })
        )}
      </g>
      <SvgFlightEngine ref={flightRef} />
    </svg>
  );
}