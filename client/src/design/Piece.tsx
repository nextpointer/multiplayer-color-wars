import { motion, useReducedMotion } from "motion/react";
import { SPRING, DUR } from "./motion";

export type PieceState = "idle" | "mine" | "charged" | "ghosted";

export type PieceProps = {
  color: string;
  count: number;
  size: number;
  state?: PieceState;
  press?: boolean;
  ariaLabel?: string;
  fillColor?: string;
  highlightColor?: string;
};

type Slot = { x: number; y: number };

function slotsFor(count: number, d: number): Slot[] {
  if (count <= 1) return [{ x: 0, y: 0 }];
  if (count === 2) {
    const off = 0.14 * d;
    return [
      { x: -off, y: 0 },
      { x: off, y: 0 },
    ];
  }
  if (count === 3) {
    const r = 0.26 * d;
    return [
      { x: 0, y: -r },
      { x: -r * 0.8660254, y: r * 0.5 },
      { x: r * 0.8660254, y: r * 0.5 },
    ];
  }
  // 4: diamond up/right/down/left
  const r = 0.24 * d;
  return [
    { x: 0, y: -r },
    { x: r, y: 0 },
    { x: 0, y: r },
    { x: -r, y: 0 },
  ];
}

export function Piece({
  color,
  count,
  size,
  state = "idle",
  press = false,
  ariaLabel,
  fillColor,
  highlightColor,
}: PieceProps) {
  const clamped = Math.max(0, Math.min(4, count));
  const slots = slotsFor(clamped, size);
  const dotSize = Math.max(2, size * 0.162);
  const isCharged = state === "charged" || clamped === 3;
  const ghosted = state === "ghosted";
  const baseFill = state === "mine" ? (fillColor ?? highlightColor ?? color) : color;

  return (
    <div
      aria-label={ariaLabel ?? `${clamped} dot${clamped === 1 ? "" : "s"}`}
      role="img"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: baseFill,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: ghosted ? 0.35 : 1,
        transform: press ? "scale(0.88)" : "none",
      }}
    >
      {isCharged && (
        <div
          style={{
            position: "absolute",
            width: "110%",
            height: "110%",
            left: "-5%",
            top: "-5%",
            borderRadius: "50%",
            border: `2px solid ${color}`,
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        />
      )}
      {slots.map((slot, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: dotSize,
            height: dotSize,
            marginLeft: -dotSize / 2,
            marginTop: -dotSize / 2,
            transform: `translate(${slot.x}px, ${slot.y}px)`,
            borderRadius: "50%",
            background: "#FFFFFF",
            opacity: ghosted ? 0.5 : 1,
          }}
        />
      ))}
    </div>
  );
}
