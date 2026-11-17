import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { SPRING } from "./motion";
import { play, haptic } from "./sound";

export type IconGlyph = "back" | "help" | "gear" | "speaker-on" | "speaker-off" | "copy" | "check" | "crown" | "close";

export type IconButtonProps = {
  variant: "light" | "navy" | "ghost";
  icon: IconGlyph;
  onClick?: () => void;
  ariaLabel: string;
  style?: CSSProperties;
  disabled?: boolean;
};

function Glyph({ icon, stroke }: { icon: IconGlyph; stroke: string }) {
  const common = { stroke, strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (icon) {
    case "back":
      return <path d="M14 6 L8 12 L14 18" {...common} />;
    case "help":
      return (
        <>
          <path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-.8.7-1.7 1.3-1.7 2.7" {...common} />
          <circle cx="12" cy="17.5" r="1.2" fill={stroke} stroke="none" />
        </>
      );
    case "gear":
      return (
        <>
          <circle cx="12" cy="12" r="3" {...common} />
          <path d="M12 5v2M12 17v2M5 12h2M17 12h2M7.1 7.1l1.4 1.4M15.5 15.5l1.4 1.4M16.9 7.1l-1.4 1.4M8.5 15.5l-1.4 1.4" {...common} />
        </>
      );
    case "speaker-on":
      return (
        <>
          <path d="M6 10h3l4-3v10l-4-3H6z" {...common} />
          <path d="M16 9.5a3.5 3.5 0 0 1 0 5M18 7.5a6 6 0 0 1 0 9" {...common} />
        </>
      );
    case "speaker-off":
      return (
        <>
          <path d="M6 10h3l4-3v10l-4-3H6z" {...common} />
          <path d="M16 9l4 6M20 9l-4 6" {...common} />
        </>
      );
    case "copy":
      return (
        <>
          <rect x="9" y="9" width="9" height="10" rx="2" {...common} />
          <path d="M15 9V7a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1" {...common} />
        </>
      );
    case "check":
      return <path d="M6.5 12.5l3.5 3.5 7.5-8" {...common} />;
    case "crown":
      return <path d="M5 16h14l-1.2-7-3.8 3-2-4-2 4-3.8-3z" {...common} />;
    case "close":
      return <path d="M6 6 L18 18 M18 6 L6 18" {...common} />;
  }
}

export function IconButton({ variant, icon, onClick, ariaLabel, style, disabled }: IconButtonProps) {
  const reduce = useReducedMotion();
  let bg = "var(--cw-cloud)";
  let stroke = "var(--cw-ink)";
  if (variant === "navy") {
    bg = "var(--cw-pill)";
    stroke = "#FFFFFF";
  } else if (variant === "ghost") {
    bg = "transparent";
    stroke = "#FFFFFF";
  }
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.88 }}
      transition={reduce ? { duration: 0.09 } : SPRING.pop}
      onClick={() => {
        if (disabled) return;
        play("ui.tap");
        haptic("light");
        onClick?.();
      }}
      style={{
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: bg,
        border: variant === "ghost" ? "2px solid rgba(255,255,255,0.4)" : "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        ...style,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
        <Glyph icon={icon} stroke={stroke} />
      </svg>
    </motion.button>
  );
}
