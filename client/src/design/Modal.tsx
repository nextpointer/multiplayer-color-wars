import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { SPRING } from "./motion";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
};

export function Modal({ open, onClose, title, children, actions }: ModalProps) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(42,46,57,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={reduce ? { duration: 0.12 } : SPRING.soft}
            style={{
              width: "100%",
              maxWidth: "min(92vw, 420px)",
              maxHeight: "70dvh",
              background: "var(--cw-cloud)",
              borderRadius: 28,
              padding: 24,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              color: "var(--cw-ink)",
            }}
          >
            {title ? (
              <h2 className="cw-h2" style={{ margin: "0 0 12px 0" }}>
                {title}
              </h2>
            ) : null}
            <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>{children}</div>
            {actions ? <div style={{ marginTop: 16, display: "flex", gap: 12, justifyContent: "flex-end" }}>{actions}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
