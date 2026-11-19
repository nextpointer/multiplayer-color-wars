import { motion, useReducedMotion } from "motion/react";
import { SPRING, EASE } from "./motion";
import { seatTilt } from "./tokens";

export type ConnQuality = "good" | "ok" | "bad" | "offline";

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
  connQuality?: ConnQuality;
  pingMs?: number | null;
  isMe?: boolean;
  statusLabel?: string | null;
  showMyPing?: boolean;
  turnDurationMs?: number | null;
  turnDeadline?: number | null;
  timerActive?: boolean;
  teamLabel?: string | null;
};

function connColor(q?: ConnQuality) {
  if (q === "good") return "#22c55e";
  if (q === "ok") return "#eab308";
  if (q === "bad") return "#ef4444";
  if (q === "offline") return "#6b7280";
  return null;
}

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
  connQuality,
  pingMs,
  isMe = false,
  statusLabel = null,
  showMyPing = false,
  teamLabel = null,
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
  const qColor = connColor(connQuality);

  return (
    <motion.div
      animate={{
        x: tucked ? tuckOffset.x : 0,
        y: tucked ? tuckOffset.y : 0,
        opacity: tucked ? 0 : ghosted ? 0.4 : 1,
        scale: 1,
      }}
      transition={{ duration: 0.2, ease: EASE.snap }}
      title={
        name
          ? `${name}${statusLabel ? ` • ${statusLabel}` : ""}${isMe && pingMs != null ? ` • ${pingMs}ms` : ""}`
          : isMe && pingMs != null
            ? `${pingMs}ms`
            : undefined
      }
      aria-label={name ? `${name}: ${score}${statusLabel ? `, ${statusLabel}` : ""}` : `Score ${score}`}
      style={{
        height,
        minWidth: compact ? 56 : 72,
        padding: compact ? "0 12px" : "0 18px",
        borderRadius: 999,
        background: "var(--cw-pill)",
        border: `${active ? 3 : 4}px solid ${active ? color : "var(--cw-outline)"}`,
        boxShadow: qColor ? `0 0 0 3px ${qColor}55, 0 0 0 1px ${qColor}` : "0 4px 10px rgba(0,0,0,0.10)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        boxSizing: "border-box",
        position: "relative",
        overflow: "visible",
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
      {teamLabel && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 900,
            color: "#fff",
            opacity: 0.95,
            lineHeight: 1,
            padding: "2px 6px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.18)",
            whiteSpace: "nowrap",
          }}
        >
          {teamLabel}
        </span>
      )}
      {!compact && name ? (
        <span className="cw-truncate" style={{ fontSize: 14, fontWeight: 700, color: "#fff", maxWidth: 96 }}>
          {name}
        </span>
      ) : null}
      {isMe && showMyPing && pingMs != null && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "#fff",
            opacity: 0.9,
            lineHeight: 1,
            padding: "2px 6px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.18)",
          }}
        >
          {pingMs}ms
        </span>
      )}
      {!isMe && statusLabel && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "#fff",
            opacity: 0.95,
            lineHeight: 1,
            padding: "2px 6px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.35)",
            whiteSpace: "nowrap",
          }}
        >
          {statusLabel}
        </span>
      )}
    </motion.div>
  );
}
