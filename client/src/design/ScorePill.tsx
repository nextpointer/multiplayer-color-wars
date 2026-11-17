import { motion, useReducedMotion } from "motion/react";
import { SPRING, EASE } from "./motion";
import { seatTilt } from "./tokens";

export type ScorePillProps = {
  score: number;
  color: string;
  seatIndex: number;
  active?: boolean;
  tucked?: boolean;
  ghosted?: boolean;
  compact?: boolean;
  name?: string;
  showMiniMascot?: boolean;
  bumpKey?: number | string;
  tuckDirection?: "left" | "right" | "up" | "down";
};

export function ScorePill({
  score,
  color,
  seatIndex,
  active = false,
  tucked = false,
  ghosted = false,
  compact = false,
  name,
  bumpKey,
  tuckDirection = "left",
}: ScorePillProps) {
  const reduce = useReducedMotion();
  const height = compact ? 44 : 56;
  const tilt = seatTilt(seatIndex);
  const tuckOffset =
    tuckDirection === "left"
      ? { x: -8, y: 0 }
      : tuckDirection === "right"
        ? { x: 8, y: 0 }
        : tuckDirection === "up"
          ? { x: 0, y: -8 }
          : { x: 0, y: 8 };

  return (
    <motion.div
      animate={{
        x: tucked ? tuckOffset.x : 0,
        y: tucked ? tuckOffset.y : 0,
        opacity: tucked ? 0 : ghosted ? 0.4 : 1,
      }}
      transition={{ duration: 0.2, ease: EASE.snap }}
      title={name}
      aria-label={name ? `${name}: ${score}` : `Score ${score}`}
      style={{
        height,
        minWidth: compact ? 56 : 72,
        padding: compact ? "0 14px" : "0 18px",
        borderRadius: 999,
        background: "var(--cw-pill)",
        border: `${active ? 3 : 4}px solid ${active ? color : "var(--cw-outline)"}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        boxSizing: "border-box",
      }}
    >
      <motion.span
        key={bumpKey}
        initial={false}
        animate={bumpKey !== undefined ? { scale: [1, 1.18, 1] } : { scale: 1 }}
        transition={reduce ? { duration: 0.12 } : SPRING.pop}
        className="cw-score"
        style={{
          color,
          display: "inline-block",
          transform: `rotate(${tilt}deg)`,
          lineHeight: 1,
        }}
      >
        {score}
      </motion.span>
      {!compact && name ? (
        <span className="cw-truncate" style={{ fontSize: 14, fontWeight: 700, color: "#fff", maxWidth: 96 }}>
          {name}
        </span>
      ) : null}
    </motion.div>
  );
}
