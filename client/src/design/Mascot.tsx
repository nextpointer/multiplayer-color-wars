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
  const bodyW = 1.18 * d;
  const bodyH = 1.28 * d;
  const podiumW = 2.6 * d;
  const podiumH = 0.9 * d;
  const totalW = Math.max(podiumW, bodyW);
  const totalH = headD * 0.74 + bodyH + podiumH * 0.6;
  const ghost = state === "ghost";
  const fill = ghost ? "var(--cw-ink-soft)" : color;
  const opacity = ghost ? 0.15 : 1;

  const shouldCheer = state === "cheer";
  const shouldEnter = state === "entrance";
  const headLeft = (totalW - headD) / 2;
  const headBottom = (ghost ? podiumH * 0.25 : podiumH * 0.45) + bodyH - headD * 0.32;
  const eyeY = headBottom + headD * 0.58;
  const eyeOffset = headD * 0.17;
  const eyeSize = Math.max(3.2, d * 0.085);
  const blushW = Math.max(5, d * 0.16);
  const blushH = Math.max(3, d * 0.09);

  return (
    <motion.div
      key={animateKey}
      initial={shouldEnter && !reduce ? { y: -16, scaleY: 0.9, scaleX: 1.05, opacity: 0 } : false}
      animate={
        shouldCheer && !reduce
          ? { y: [0, -13, 0], scaleY: [1, 1.08, 0.95, 1], scaleX: [1, 0.96, 1.04, 1], rotate: [0, -2, 2, 0], opacity }
          : { y: 0, scaleY: 1, scaleX: 1, rotate: 0, opacity }
      }
      transition={
        shouldCheer
          ? { duration: 0.65, times: [0, 0.45, 1], ease: "easeOut" }
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
              background: "rgba(0,0,0,0.10)",
              filter: "blur(1.5px)",
              opacity: 0.45,
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
              background: "linear-gradient(180deg, #FFFFFF 0%, #F3F6FA 100%)",
              boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.04)",
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
          borderTopLeftRadius: "48%",
          borderTopRightRadius: "48%",
          borderBottomLeftRadius: "44%",
          borderBottomRightRadius: "44%",
          background: ghost ? fill : `linear-gradient(180deg, ${fill} 0%, ${fill} 70%, rgba(0,0,0,0.06) 100%)`,
          opacity,
          boxShadow: ghost ? undefined : "inset -4px -6px 0 rgba(255,255,255,0.10), inset 3px 3px 0 rgba(255,255,255,0.08)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: headLeft,
          bottom: headBottom,
          width: headD,
          height: headD,
          borderRadius: "50%",
          background: ghost ? fill : `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), transparent 35%), ${fill}`,
          opacity,
          boxShadow: ghost ? undefined : "inset -3px -4px 0 rgba(0,0,0,0.04)",
        }}
      />
      {!ghost && (
        <>
          <div style={{ position: "absolute", left: headLeft + headD / 2 - eyeOffset - eyeSize / 2, bottom: eyeY, width: eyeSize, height: eyeSize * 1.1, borderRadius: "50%", background: "rgba(42,46,57,0.82)" }} />
          <div style={{ position: "absolute", left: headLeft + headD / 2 + eyeOffset - eyeSize / 2, bottom: eyeY, width: eyeSize, height: eyeSize * 1.1, borderRadius: "50%", background: "rgba(42,46,57,0.82)" }} />
          <div style={{ position: "absolute", left: headLeft + headD / 2 - eyeOffset - eyeSize * 0.15, bottom: eyeY + eyeSize * 0.45, width: eyeSize * 0.38, height: eyeSize * 0.38, borderRadius: "50%", background: "rgba(255,255,255,0.95)" }} />
          <div style={{ position: "absolute", left: headLeft + headD / 2 + eyeOffset - eyeSize * 0.15, bottom: eyeY + eyeSize * 0.45, width: eyeSize * 0.38, height: eyeSize * 0.38, borderRadius: "50%", background: "rgba(255,255,255,0.95)" }} />
          <div style={{ position: "absolute", left: headLeft + headD * 0.12, bottom: eyeY - headD * 0.14, width: blushW, height: blushH, borderRadius: 999, background: "rgba(255,140,160,0.28)" }} />
          <div style={{ position: "absolute", right: totalW - (headLeft + headD * 0.88), bottom: eyeY - headD * 0.14, width: blushW, height: blushH, borderRadius: 999, background: "rgba(255,140,160,0.28)" }} />
        </>
      )}
      {smile && !ghost && (
        <div
          style={{
            position: "absolute",
            left: headLeft + (headD - headD * 0.34) / 2,
            bottom: headBottom + headD * 0.26,
            width: headD * 0.34,
            height: headD * 0.17,
            borderBottom: `${Math.max(2.5, d * 0.052)}px solid rgba(66, 50, 76, 0.72)`,
            borderRadius: "0 0 999px 999px",
            opacity,
            pointerEvents: "none",
          }}
        />
      )}
      {!smile && !ghost && (
        <div
          style={{
            position: "absolute",
            left: headLeft + (headD - headD * 0.18) / 2,
            bottom: headBottom + headD * 0.30,
            width: headD * 0.18,
            height: Math.max(2, d * 0.045),
            borderRadius: 999,
            background: "rgba(66,50,76,0.55)",
          }}
        />
      )}
    </motion.div>
  );
}
