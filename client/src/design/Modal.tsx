import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { IconButton } from "./IconButton";
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          data-testid="modal-backdrop"
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
              maxWidth: "min(94vw, 420px)",
              maxHeight: "80dvh",
              background: "var(--cw-cloud)",
              borderRadius: 24,
              padding: "clamp(16px, 4vw, 24px)",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              color: "var(--cw-ink)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: title ? 12 : 8 }}>
              {title ? (
                <h2 className="cw-h2" style={{ margin: 0, minWidth: 0 }}>
                  {title}
                </h2>
              ) : <span />}
              <IconButton
                variant="ghost"
                icon="close"
                ariaLabel="Close"
                onClick={onClose}
                style={{ width: 40, height: 40, minWidth: 40, minHeight: 40, flex: "0 0 40px" }}
              />
            </div>
            <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>{children}</div>
            {actions ? <div style={{ marginTop: 16, display: "flex", gap: 12, justifyContent: "flex-end" }}>{actions}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
