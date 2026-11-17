import type { ReactNode } from "react";
import { Mascot } from "./Mascot";

export type PlayerSlotState = "open" | "joined" | "ready" | "host" | "me";

export type PlayerSlotProps = {
  name?: string;
  color?: string;
  state: PlayerSlotState;
  statusText?: string;
  right?: ReactNode;
};

export function PlayerSlot({ name, color = "var(--cw-ink-soft)", state, statusText, right }: PlayerSlotProps) {
  const open = state === "open";
  const label = open ? "Waiting…" : name ?? "Player";
  const caption =
    statusText ?? (state === "ready" ? "Ready" : state === "host" ? "Host" : state === "me" ? "You" : "Joined");

  return (
    <div
      style={{
        height: 72,
        borderRadius: 24,
        background: "var(--cw-cloud)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px 0 8px",
        gap: 8,
        position: "relative",
        border: open ? "2px dashed rgba(42,46,57,0.25)" : "2px solid transparent",
        boxSizing: "border-box",
      }}
    >
      <div style={{ marginLeft: -8, flex: "0 0 auto" }}>
        <Mascot color={open ? "var(--cw-ink-soft)" : color} size="md" state={open ? "ghost" : "idle"} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="cw-truncate" style={{ fontSize: 17, fontWeight: 700, color: open ? "var(--cw-ink-soft)" : "var(--cw-ink)" }}>
          {label}
        </div>
        <div className="cw-caption" style={{ color: open ? "var(--cw-ink-soft)" : "var(--cw-ink-soft)" }}>
          {open ? "Open slot" : caption}
        </div>
      </div>
      {right ? <div style={{ flex: "0 0 auto" }}>{right}</div> : null}
    </div>
  );
}
