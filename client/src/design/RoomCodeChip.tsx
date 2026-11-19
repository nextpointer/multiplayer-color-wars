import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { SPRING } from "./motion";
import { play, haptic } from "./sound";

export type RoomCodeChipProps = {
  code: string;
  onCopied?: () => void;
  onCopyText?: () => void;
};

function Icon({ check }: { check: boolean }) {
  const common = { stroke: "#fff", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return check ? (
    <path d="M6.5 12.5l3.5 3.5 7.5-8" {...common} />
  ) : (
    <>
      <rect x="9" y="9" width="9" height="10" rx="2" {...common} />
      <path d="M15 9V7a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1" {...common} />
    </>
  );
}

export function RoomCodeChip({ code, onCopied }: RoomCodeChipProps) {
  const reduce = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const [popKey, setPopKey] = useState(0);

  const doCopy = async () => {
    const shareUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard?.writeText(shareUrl);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        // ignore
      }
    }
    play("ui.tap");
    haptic("light");
    setCopied(true);
    setPopKey((k) => k + 1);
    onCopied?.();
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <motion.button
      type="button"
      onClick={doCopy}
      aria-label={`Room code ${code}, tap to copy invite link`}
      key={popKey}
      animate={{ scale: copied && !reduce ? [1, 1.06, 1] : 1 }}
      transition={reduce ? { duration: 0.12 } : { duration: 0.2, ease: "easeOut" }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px 8px 16px",
        borderRadius: 999,
        background: "var(--cw-pill)",
        border: "none",
        color: "#fff",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.1 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", opacity: 0.8 }}>ROOM</span>
        <span data-testid="room-code" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "2px" }}>{code}</span>
      </span>
      <motion.span
        key={copied ? "check" : "copy"}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        style={{ display: "inline-flex" }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
          <Icon check={copied} />
        </svg>
      </motion.span>
    </motion.button>
  );
}
