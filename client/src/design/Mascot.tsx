import { motion, useReducedMotion } from "motion/react";
import { SPRING } from "./motion";

export type MascotSize = "lg" | "md" | "sm";
export type MascotState = "idle" | "entrance" | "cheer" | "ghost";

export type MascotProps = {
  color?: string;
  size?: MascotSize;
  state?: MascotState;
  animateKey?: number | string;
  smile?: boolean;
};

const D: Record<MascotSize, number> = { lg: 56, md: 40, sm: 20 };

export function Mascot({ color = "var(--cw-ink)", size = "md", state = "idle", animateKey, smile = false }: MascotProps) {
  const reduce = useReducedMotion();
  const d = D[size];
  const headD = d;
  const bodyW = 1.15 * d;
  const bodyH = 1.3 * d;
  const podiumW = 2.6 * d;
  const podiumH = 0.9 * d;
  const totalW = Math.max(podiumW, bodyW);
  const totalH = headD * 0.7 + bodyH + podiumH * 0.6;
  const ghost = state === "ghost";
  const fill = ghost ? "var(--cw-ink-soft)" : color;
  const opacity = ghost ? 0.15 : 1;

  const shouldCheer = state === "cheer";
  const shouldEnter = state === "entrance";

  return (
    <motion.div
      key={animateKey}
      initial={shouldEnter && !reduce ? { y: -16, scaleY: 0.9, scaleX: 1.05, opacity: 0 } : false}
      animate={
        shouldCheer && !reduce
          ? { y: [0, -12, 0], scaleY: [1, 1.08, 0.94, 1], scaleX: [1, 0.95, 1.04, 1], opacity }
          : { y: 0, scaleY: 1, scaleX: 1, opacity }
      }
      transition={
        shouldCheer
          ? { duration: 0.6, times: [0, 0.4, 1], ease: "easeOut" }
          : reduce
            ? { duration: 0.12 }
            : SPRING.pop
      }
      style={{ width: totalW, height: totalH, position: "relative", display: "inline-block" }}
      aria-hidden
    >
      {!ghost && (
        <>
          <div
            style={{
              position: "absolute",
              left: (totalW - podiumW) / 2,
              bottom: podiumH * 0.15,
              width: podiumW,
              height: podiumH * 0.5,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.12)",
              filter: "blur(1px)",
              opacity: 0.4,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: (totalW - podiumW) / 2,
              bottom: 0,
              width: podiumW,
              height: podiumH,
              borderRadius: "50%",
              background: "#FFFFFF",
            }}
          />
        </>
      )}
      <div
        style={{
          position: "absolute",
          left: (totalW - bodyW) / 2,
          bottom: ghost ? podiumH * 0.25 : podiumH * 0.45,
          width: bodyW,
          height: bodyH,
          borderTopLeftRadius: "45%",
          borderTopRightRadius: "45%",
          borderBottomLeftRadius: "40%",
          borderBottomRightRadius: "40%",
          background: fill,
          opacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: (totalW - headD) / 2,
          bottom: (ghost ? podiumH * 0.25 : podiumH * 0.45) + bodyH - headD * 0.35,
          width: headD,
          height: headD,
          borderRadius: "50%",
          background: fill,
          opacity,
        }}
      />
      {smile && !ghost && (
        <div
          style={{
            position: "absolute",
            left: (totalW - headD * 0.38) / 2,
            bottom: (podiumH * 0.45) + bodyH - headD * 0.35 + headD * 0.28,
            width: headD * 0.38,
            height: headD * 0.18,
            borderBottom: `${Math.max(2.5, d * 0.055)}px solid rgba(66, 50, 76, 0.72)`,
            borderRadius: "0 0 999px 999px",
            opacity,
            pointerEvents: "none",
          }}
        />
      )}
    </motion.div>
  );
}
