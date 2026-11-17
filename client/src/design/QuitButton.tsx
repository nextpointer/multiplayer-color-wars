import { motion, useReducedMotion } from "motion/react";
import { SPRING } from "./motion";
import { play, haptic } from "./sound";

export type QuitButtonProps = {
  onClick?: () => void;
  style?: React.CSSProperties;
  ariaLabel?: string;
};

export function QuitButton({ onClick, style, ariaLabel = "Quit" }: QuitButtonProps) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      onClick={() => {
        play("ui.back");
        haptic("light");
        onClick?.();
      }}
      whileTap={{ scale: 0.88 }}
      transition={reduce ? { duration: 0.09 } : SPRING.pop}
      style={{
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "#FFFFFF",
        border: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        cursor: "pointer",
        boxShadow: "0 2px 0 rgba(0,0,0,0.06)",
        ...style,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
        <path d="M6 6 L18 18 M18 6 L6 18" stroke="var(--cw-ink)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </motion.button>
  );
}
