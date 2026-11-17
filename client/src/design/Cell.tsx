import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export type CellState = "empty" | "mine" | "capture-target" | "flash" | "disabled";

export type CellProps = {
  size: number;
  state?: CellState;
  mineFill?: string;
  flashing?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  ariaLabel?: string;
};

export function Cell({
  size,
  state = "empty",
  mineFill,
  flashing = false,
  disabled = false,
  onClick,
  children,
  ariaLabel,
}: CellProps) {
  const reduce = useReducedMotion();
  const isDisabled = disabled || state === "disabled";
  let bg = "var(--cw-cell)";
  if (state === "mine" && mineFill) bg = mineFill;
  if (state === "capture-target") bg = "var(--cw-cell-flash)";

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
      style={{
        width: size,
        height: size,
        borderRadius: "24%",
        border: "none",
        padding: 0,
        margin: 0,
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        cursor: isDisabled ? "default" : "pointer",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        transition: "background-color 350ms ease",
      }}
    >
      {children}
    </button>
  );
}
