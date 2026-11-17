import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE } from "./motion";

export type CountdownStep = "3" | "2" | "1" | "GO" | null;

export function CountdownOverlay({
  step,
  playerColor = "var(--cw-action)",
}: {
  step: CountdownStep;
  playerColor?: string;
}) {
  const reduce = useReducedMotion();
  const isGo = step === "GO";
  return (
    <AnimatePresence>
      {step ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(42, 46, 57, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <motion.div
            key={step}
            initial={reduce ? { opacity: 0 } : { scale: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { scale: [0, 1.2, 1], opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={
              isGo
                ? { duration: 0.5, ease: EASE.pop }
                : { duration: 0.4, ease: EASE.pop }
            }
            style={{
              fontSize: 120,
              fontWeight: 800,
              lineHeight: 1,
              color: isGo ? "var(--cw-action)" : playerColor,
              textShadow: "0 4px 0 rgba(0,0,0,0.1)",
            }}
          >
            {step}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
