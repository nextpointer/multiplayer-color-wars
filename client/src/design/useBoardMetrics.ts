import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getEffectiveViewport } from "./useViewport";

export interface BoardMetrics {
  boardSize: number;
  cell: number;
  piece: number;
  dot: number;
  gap: number;
}

export interface Reserve {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function computeBoardMetrics(zoneW: number, zoneH: number, rows: number, cols: number): BoardMetrics {
  const safeW = Math.max(0, zoneW);
  const safeH = Math.max(0, zoneH);
  const denomW = cols + 0.1 * Math.max(0, cols - 1);
  const denomH = rows + 0.1 * Math.max(0, rows - 1);
  const fitCell = Math.min(
    denomW > 0 ? safeW / denomW : 0,
    denomH > 0 ? safeH / denomH : 0
  );
  // Prefer fitting the full board in view (responsive, no overflow). Cap to avoid oversized cells.
  let cell = fitCell;
  const maxByDim = Math.min(
    denomW > 0 ? 720 / denomW : 720,
    denomH > 0 ? 720 / denomH : 720
  );
  if (Number.isFinite(maxByDim)) cell = Math.min(cell, maxByDim);
  // Keep a tiny safety floor for extreme cases while still favoring fit.
  if (Number.isFinite(fitCell) && fitCell > 0) cell = Math.max(8, cell);
  if (!Number.isFinite(cell) || cell < 0) cell = 0;
  const gap = cell * 0.1;
  const piece = cell * 0.78;
  const dot = cell * 0.13;
  const boardW = cols * cell + Math.max(0, cols - 1) * gap;
  const boardH = rows * cell + Math.max(0, rows - 1) * gap;
  return { boardSize: Math.min(boardW, boardH), cell, piece, dot, gap };
}

export function useBoardMetrics(
  containerRef: React.RefObject<HTMLElement | null>,
  rows: number,
  cols: number,
  reserves: Reserve
) {
  const [m, setM] = useState<BoardMetrics>({ boardSize: 0, cell: 0, piece: 0, dot: 0, gap: 0 });
  const metricsRef = useRef(m);
  useLayoutEffect(() => {
    metricsRef.current = m;
  }, [m]);

  useEffect(() => {
    const calc = () => {
      const vp = getEffectiveViewport();
      const vw = vp.width;
      const vh = vp.height;
      // in forced landscape, reserves should be interpreted for landscape layout
      const zoneW = Math.max(0, vw - reserves.left - reserves.right);
      const zoneH = Math.max(0, vh - reserves.top - reserves.bottom);
      const mm = computeBoardMetrics(zoneW, zoneH, rows, cols);
      const clean = {
        boardSize: Number.isFinite(mm.boardSize) ? mm.boardSize : 0,
        cell: Number.isFinite(mm.cell) ? mm.cell : 0,
        piece: Number.isFinite(mm.piece) ? mm.piece : 0,
        dot: Number.isFinite(mm.dot) ? mm.dot : 0,
        gap: Number.isFinite(mm.gap) ? mm.gap : 0,
      };
      setM(clean);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(document.documentElement);
    window.addEventListener("resize", calc);
    window.addEventListener("orientationchange", calc);
    return () => { ro.disconnect(); window.removeEventListener("resize", calc); window.removeEventListener("orientationchange", calc); };
  }, [rows, cols, reserves.top, reserves.bottom, reserves.left, reserves.right]);

  return { metrics: m, metricsRef };
}
