import React from "react";
import { CloudField, PlumPattern } from "../design/BackdropDecor";
import { IconButton } from "../design/IconButton";
import { PrimaryPillButton } from "../design/PrimaryPillButton";
import { RoomCodeChip } from "../design/RoomCodeChip";
import { PlayerSlot } from "../design/PlayerSlot";
import { Modal } from "../design/Modal";
import { SURFACES, visualsForPlayer } from "../design/tokens";
import { play } from "../design/sound";
import { useToast } from "../design/Toast";
import { SettingsRows } from "./HomeFlow";
import type { Settings } from "../state/settings";

export function LobbyScreen(props: {
  roomId: string;
  players: { id: number; name: string; color: string; connected?: boolean; quality?: "good" | "ok" | "bad" | "offline" }[];
  hostId: number | null;
  playerId: number | null;
  onStart: () => void;
  onBack: () => void;
  onOpenSettings: () => void;
  showSettings: boolean; setShowSettings: (v: boolean) => void;
  settings: Settings;
  setMuted: (v:boolean)=>void; setHaptics:(v:boolean)=>void; setChainSpeed:(v:any)=>void;
  maxPlayers?: number;
  rows?: number;
  cols?: number;
}) {
  const { roomId, players, hostId, playerId, onStart, onBack, showSettings, setShowSettings, maxPlayers: maxPlayersProp, rows, cols } = props;
  const { show: toast } = useToast();
  const isHost = hostId === playerId;
  const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(maxPlayersProp) || 8)));
  const slotCount = Math.min(maxPlayers, Math.max(players.length + (players.length < maxPlayers ? 1 : 0), 2));
  const slots = Array.from({ length: slotCount }, (_, i) => players[i] || null);
  const me = players.find(p => p.id === playerId);

  return (
    <div className="cw-page-shell cw-no-scrollbar" style={{ background: SURFACES.azure, position: "relative", overflowY: "auto" }}>
      <div style={{ background: SURFACES.plum, minHeight: 120, position: "relative", overflow: "hidden", padding: "14px 12px 16px" }}>
        <PlumPattern />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 180px" }}>
            <IconButton variant="light" icon="back" ariaLabel="Back" onClick={() => { play("ui.back"); onBack(); }} />
            <div style={{ textAlign: "left", minWidth: 0 }}>
              <div className="cw-h1" style={{ color: SURFACES.whiteText, lineHeight: 1.1, fontSize: "clamp(22px,6vw,32px)" }}>Game Lobby</div>
              <div className="cw-caption" style={{ color: "rgba(255,255,255,0.85)", marginTop: 2 }}>Share the room code to invite players</div>
            </div>
          </div>
          <div style={{ flex: "0 0 auto", marginLeft: "auto" }}>
            <RoomCodeChip code={roomId} onCopied={() => toast("Invite link copied")} />
          </div>
        </div>
      </div>

      <div style={{ padding: "18px 16px 150px", maxWidth: 760, margin: "0 auto", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <div className="cw-caption" style={{ letterSpacing: 1 }}>PLAYERS</div>
            <div className="cw-body" style={{ color: SURFACES.ink, fontWeight: 700 }}>{players.length} / {maxPlayers} joined</div>
            {rows && cols ? <div className="cw-caption" style={{ color: SURFACES.inkSoft, marginTop: 2 }}>Grid {rows}×{cols}</div> : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{ padding: "6px 10px", borderRadius: 999, background: SURFACES.cloud, color: SURFACES.inkSoft, fontSize: 12, fontWeight: 700 }}>
              {isHost ? "You are the host" : "Waiting for host to start"}
            </span>
            {me && (
              <span style={{ padding: "6px 10px", borderRadius: 999, background: SURFACES.cloud, color: SURFACES.inkSoft, fontSize: 12, fontWeight: 700 }}>
                Joined as {me.name}
              </span>
            )}
          </div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.18)", borderRadius: 20, padding: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {slots.map((p, i) => {
              const state = !p ? "open" : p.id === hostId ? "host" : p.id === playerId ? "me" : "joined";
              const statusText = !p
                ? "Open slot"
                : p.id === playerId && p.id === hostId
                  ? "You · Host"
                  : p.id === playerId
                    ? "You"
                    : p.id === hostId
                      ? "Host"
                      : "Ready";
              return (
                <PlayerSlot
                  key={p ? `p-${p.id}` : `open-${i}`}
                  name={p?.name}
                  color={p ? visualsForPlayer(p.color, p.id).base : undefined}
                  state={state}
                  statusText={statusText}
                />
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          {isHost ? (
            <>
              <PrimaryPillButton label="START GAME" onClick={onStart} disabled={players.length < 2} />
              <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>
                {players.length < 2 ? "Need at least 2 players to start" : `${players.length} player${players.length === 1 ? "" : "s"} ready · Tap start when everyone is in`}
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: "12px 16px", borderRadius: 16, background: SURFACES.cloud, color: SURFACES.ink, fontWeight: 700 }}>
                Waiting for host to start…
              </div>
              <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>
                The game will begin once the host starts. You can share the room code with friends.
              </div>
            </>
          )}
        </div>
      </div>
      <CloudField />
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Settings"><SettingsRows /></Modal>
    </div>
  );
}
