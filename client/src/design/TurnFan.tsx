import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE } from "./motion";

export type TurnFanCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top" | "bottom";

export type TurnFanProps = {
  show: boolean;
  playerColor: string;
  fanColor: string;
  confettiLight: string;
  label: string;
  corner: TurnFanCorner;
  boardSize: number;
  timer?: string | number;
};

function pathFor(corner: TurnFanCorner, r: number, size: number) {
  // quarter circle wedge anchored to a corner/edge within a square box of boardSize
  // We'll draw in a local svg sized by r
  if (corner === "top-left") {
    return { d: `M 0 0 L ${r} 0 A ${r} ${r} 0 0 1 0 ${r} Z`, box: { left: 0, top: 0, w: r, h: r }, textAnchor: { x: r * 0.35, y: r * 0.35, rot: -45 } };
  }
  if (corner === "top-right") {
    return { d: `M ${r} 0 L 0 0 A ${r} ${r} 0 0 0 ${r} ${r} Z`, box: { left: size - r, top: 0, w: r, h: r }, textAnchor: { x: r * 0.65, y: r * 0.35, rot: 45 } };
  }
  if (corner === "bottom-left") {
    return { d: `M 0 ${r} L 0 0 A ${r} ${r} 0 0 1 ${r} ${r} Z`, box: { left: 0, top: size - r, w: r, h: r }, textAnchor: { x: r * 0.35, y: r * 0.65, rot: 45 } };
  }
  if (corner === "bottom-right") {
    return { d: `M ${r} ${r} L ${r} 0 A ${r} ${r} 0 0 0 0 ${r} Z`, box: { left: size - r, top: size - r, w: r, h: r }, textAnchor: { x: r * 0.65, y: r * 0.65, rot: -45 } };
  }
  if (corner === "top") {
    // semicircle-ish wedge at top middle
    const cx = size / 2;
    return { d: `M ${cx - r} 0 L ${cx + r} 0 A ${r} ${r} 0 0 1 ${cx - r} 0 Z`, box: { left: 0, top: 0, w: size, h: r }, textAnchor: { x: cx, y: r * 0.45, rot: 0 } };
  }
  // bottom
  const cx = size / 2;
  return { d: `M ${cx - r} ${size} L ${cx + r} ${size} A ${r} ${r} 0 0 0 ${cx - r} ${size} Z`, box: { left: 0, top: size - r, w: size, h: r }, textAnchor: { x: cx, y: size - r * 0.45, rot: 0 } };
}

export function TurnFan({ show, playerColor, fanColor, confettiLight, label, corner, boardSize, timer }: TurnFanProps) {
  const reduce = useReducedMotion();
  const r = boardSize * 0.42;
  const { d, box, textAnchor } = pathFor(corner, r, boardSize);
  const clipId = `fan-${corner}-${Math.round(boardSize)}`;

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.35, ease: EASE.pop }}
          style={{
            position: "absolute",
            left: box.left,
            top: box.top,
            width: box.w,
            height: box.h,
            pointerEvents: "none",
            zIndex: 5,
          }}
          aria-hidden
        >
          <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} style={{ overflow: "visible" }}>
            <defs>
              <clipPath id={clipId}>
                <path d={d} transform={corner.startsWith("top") || corner.startsWith("bottom") ? undefined : corner.includes("right") ? `translate(${-box.left},${-box.top})` : `translate(${-box.left},${-box.top})`} />
              </clipPath>
            </defs>
            <path
              d={d}
              transform={`translate(${-box.left},${-box.top})`}
              fill={fanColor}
              stroke={confettiLight}
              strokeWidth={6}
            />
            <text
              x={textAnchor.x}
              y={textAnchor.y}
              transform={`rotate(${textAnchor.rot} ${textAnchor.x} ${textAnchor.y})`}
              textAnchor="middle"
              dominantBaseline="middle"
              className="cw-fan-label"
              style={{ fill: "#FFFFFF", fontWeight: 800, letterSpacing: "0.5px" }}
            >
              {label}
            </text>
            {timer != null ? (
              <text
                x={textAnchor.x}
                y={textAnchor.y + (corner.includes("bottom") ? -r * 0.18 : r * 0.18)}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ fill: "#FFFFFF", fontWeight: 800, fontSize: 64, opacity: 0.4 }}
              >
                {String(timer)}
              </text>
            ) : null}
          </svg>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
