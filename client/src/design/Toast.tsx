import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type ToastCtx = { show: (message: string) => void };
const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children, avoidQuit = false }: { children: ReactNode; avoidQuit?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const timer = useRef<number | null>(null);
  const reduce = useReducedMotion();

  const show = useCallback((message: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    setMsg(message);
    setKey((k) => k + 1);
    timer.current = window.setTimeout(() => setMsg(null), 1800);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: `calc(env(safe-area-inset-bottom, 0px) + ${avoidQuit ? 80 : 24}px)`,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
          zIndex: 40,
        }}
      >
        <AnimatePresence mode="wait">
          {msg ? (
            <motion.div
              key={key}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              style={{
                background: "var(--cw-pill)",
                color: "#FFFFFF",
                fontSize: 15,
                fontWeight: 700,
                padding: "10px 16px",
                borderRadius: 999,
                maxWidth: "min(92vw, 420px)",
                textAlign: "center",
                boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
              }}
            >
              {msg}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
