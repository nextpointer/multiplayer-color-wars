export type Cell = { col: number; row: number };
export type XY = { x: number; y: number };

export interface BoardMetrics { size: number; cols: number; cell: number; gap: number; }

export function computeMetrics(boardPx: number, cols: number): BoardMetrics {
  const cell = boardPx / (cols + (cols - 1) * 0.10); // gap = 10% of cell
  return { size: boardPx, cols, cell, gap: cell * 0.10 };
}

export function cellCenter(m: BoardMetrics, c: Cell): XY {
  return {
    x: c.col * (m.cell + m.gap) + m.cell / 2,
    y: c.row * (m.cell + m.gap) + m.cell / 2,
  };
}

export const PIECE_R_F = 0.39;   // piece radius  = 0.39 × cell
export const DOT_R_F  = 0.065;   // dot radius    = 0.065 × cell

// Formation slots, in FRACTIONS OF CELL, relative to piece center. Fixed constants.
export const SLOTS: Record<1 | 2 | 3 | 4, XY[]> = {
  1: [ { x: 0,      y: 0     } ],
  2: [ { x: -0.14,  y: 0     }, { x: 0.14,  y: 0      } ],           // horizontal pair
  3: [ { x: 0,      y: -0.15 }, { x: -0.13, y: 0.125 }, { x: 0.13, y: 0.125 } ], // triangle
  4: [ { x: 0,      y: -0.17 }, { x: 0.17,  y: 0     }, { x: 0, y: 0.17 }, { x: -0.17, y: 0 } ], // diamond
};
