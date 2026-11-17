import { motion, useReducedMotion } from "motion/react";
import { SPRING } from "./motion";
import { play, haptic } from "./sound";

export type PrimaryPillButtonProps = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
};

export function PrimaryPillButton({ label, onClick, disabled = false, className }: PrimaryPillButtonProps) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      disabled={disabled}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: disabled ? 0.4 : 1 }}
      whileTap={disabled ? undefined : { scale: 0.94, backgroundColor: "var(--cw-action-press)" }}
      transition={reduce ? { duration: 0.12 } : SPRING.pop}
      onClick={() => {
        if (disabled) return;
        play("ui.tap");
        haptic("light");
        onClick?.();
      }}
      className={className}
      style={{
        height: 64,
        padding: "0 40px",
        borderRadius: 999,
        border: "none",
        background: "var(--cw-action)",
        color: "#FFFFFF",
        fontSize: 24,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.02em",
        cursor: disabled ? "default" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span className="max-[360px]:text-[22px]" style={{ lineHeight: 1 }}>{label}</span>
    </motion.button>
  );
}
