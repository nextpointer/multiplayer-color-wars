import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";

export type BoardMetrics = {
  cell: number;
  piece: number;
  dot: number;
  gap: number;
};

export type BoardProps = {
  rows: number;
  cols: number;
  metrics: BoardMetrics;
  children: ReactNode;
  flightLayerRef?: RefObject<HTMLDivElement>;
  nudgeKey?: number;
  summary?: string;
  className?: string;
};

export function Board({
  rows,
  cols,
  metrics,
  children,
  flightLayerRef,
  nudgeKey,
  summary,
  className,
}: BoardProps) {
  const reduce = useReducedMotion();
  const prev = useRef(nudgeKey);

  // nudge handled via key-driven motion on wrapper
  const shouldNudge = nudgeKey !== undefined && prev.current !== undefined && nudgeKey !== prev.current;
  useEffect(() => {
    prev.current = nudgeKey;
  }, [nudgeKey]);

  return (
    <div className={className} style={{ position: "relative", display: "inline-block" }}>
      {summary ? (
        <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {summary}
        </div>
      ) : null}
      <motion.div
        key={nudgeKey ?? "board"}
        initial={false}
        animate={shouldNudge && !reduce ? { y: [0, 2, 0] } : { y: 0 }}
        transition={{ duration: 0.15, ease: "easeInOut" }}
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, var(--cell))`,
          gridTemplateRows: `repeat(${rows}, var(--cell))`,
          gap: "var(--gap)",
          ["--cell" as any]: `${metrics.cell}px`,
          ["--piece" as any]: `${metrics.piece}px`,
          ["--dot" as any]: `${metrics.dot}px`,
          ["--gap" as any]: `${metrics.gap}px`,
        }}
      >
        {children}
        <div
          ref={flightLayerRef}
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 20,
            overflow: "visible",
          }}
        />
      </motion.div>
    </div>
  );
}
