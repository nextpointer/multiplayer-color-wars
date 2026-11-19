import React from "react";
import { BOARD_SHAPES } from "@game/shared";
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
  players: { id: number; name: string; color: string; connected?: boolean; quality?: "good" | "ok" | "bad" | "offline"; team?: number }[];
  hostId: number | null;
  playerId: number | null;
  onStart: () => void;
  onBecomePlayer?: () => void;
  onBack: () => void;
  onOpenSettings: () => void;
  showSettings: boolean; setShowSettings: (v: boolean) => void;
  settings: Settings;
  setMuted: (v:boolean)=>void; setHaptics:(v:boolean)=>void; setChainSpeed:(v:any)=>void;
  maxPlayers?: number;
  rows?: number;
  cols?: number;
  shape?: string;
  gameTimeMinutes?: number;
  teamMode?: string;
  spectator?: boolean;
  spectatorsCount?: number;
}) {
  const { roomId, players, hostId, playerId, onStart, onBecomePlayer, onBack, showSettings, setShowSettings, maxPlayers: maxPlayersProp, rows, cols, shape, gameTimeMinutes, teamMode, spectator = false, spectatorsCount = 0 } = props;
  const { show: toast } = useToast();
  const isHost = !spectator && hostId === playerId && playerId != null && playerId >= 0;
  const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(maxPlayersProp) || 8)));
  const slotCount = Math.min(maxPlayers, Math.max(players.length + (players.length < maxPlayers ? 1 : 0), 2));
  const slots = Array.from({ length: slotCount }, (_, i) => players[i] || null);
  const me = players.find(p => p.id === playerId);
  const canJoinAsPlayer = spectator && !!onBecomePlayer && players.length < maxPlayers;
  const roomEmpty = players.length === 0;
  const timerLabel = `${gameTimeMinutes ?? 10} min game · 1 min turns`;

  return (
    <div className="cw-page-shell cw-no-scrollbar" style={{ background: "linear-gradient(180deg, #E7F4FC 0%, #F6FBFF 100%)", position: "relative", overflowY: "auto" }}>
      <div style={{ background: "linear-gradient(135deg, #42324C 0%, #5A4E63 60%, #42324C 100%)", minHeight: 128, position: "relative", overflow: "hidden", padding: "14px 12px 18px" }}>
        <PlumPattern />
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 15% 20%, rgba(255,255,255,0.12), transparent 35%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 180px" }}>
            <IconButton variant="light" icon="back" ariaLabel="Back" onClick={() => { play("ui.back"); onBack(); }} />
            <div style={{ textAlign: "left", minWidth: 0 }}>
              <div className="cw-h1" style={{ color: SURFACES.whiteText, lineHeight: 1.1, fontSize: "clamp(22px,6vw,32px)", textShadow: "0 2px 10px rgba(0,0,0,0.15)" }}>Game Lobby</div>
              <div className="cw-caption" style={{ color: "rgba(255,255,255,0.88)", marginTop: 2 }}>Share the room code to invite players</div>
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
            <div className="cw-body" style={{ color: SURFACES.ink, fontWeight: 800 }}>{players.length} / {maxPlayers} joined</div>
            {rows && cols ? <div className="cw-caption" style={{ color: SURFACES.inkSoft, marginTop: 2 }}>{BOARD_SHAPES.find(s => s.id === shape)?.label || "Grid"} {rows}×{cols}</div> : null}
            <div className="cw-caption" style={{ color: SURFACES.inkSoft, marginTop: 2 }}>⏱ {timerLabel}</div>
            {teamMode && teamMode !== "off" ? <div className="cw-caption" style={{ color: SURFACES.inkSoft, marginTop: 2 }}>Teams: {teamMode.toUpperCase()}</div> : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{ padding: "6px 10px", borderRadius: 999, background: SURFACES.cloud, color: SURFACES.inkSoft, fontSize: 12, fontWeight: 800, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              {spectator ? "You are spectating" : (isHost ? "You are the host" : "Waiting for host to start")}
            </span>
            {me && !spectator && (
              <span style={{ padding: "6px 10px", borderRadius: 999, background: SURFACES.cloud, color: SURFACES.inkSoft, fontSize: 12, fontWeight: 800, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                Joined as {me.name}
              </span>
            )}
            {spectatorsCount > 0 && (
              <span data-testid="spectators-count" style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(47,51,62,0.92)", color: "#fff", fontSize: 12, fontWeight: 800, boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}>
                👀 {spectatorsCount} spectator{spectatorsCount === 1 ? "" : "s"} watching
              </span>
            )}
          </div>
        </div>

        {spectatorsCount > 0 && (
          <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 14, background: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.9)", color: SURFACES.ink, fontWeight: 700, boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
            👀 {spectatorsCount === 1 ? "A spectator is" : `${spectatorsCount} spectators are`} watching this room.
          </div>
        )}

        <div style={{ background: "rgba(255,255,255,0.28)", border: "1px solid rgba(255,255,255,0.7)", borderRadius: 20, padding: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.06)", backdropFilter: "blur(4px)" }}>
          {players.length === 0 ? (
            <div style={{ padding: "18px 12px", textAlign: "center" }}>
              <div className="cw-body" style={{ color: SURFACES.ink, fontWeight: 800, marginBottom: 4 }}>No players in the room yet</div>
              <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>
                {canJoinAsPlayer ? "The room is empty — you can join as a player and become the host." : "Waiting for someone to join as a player."}
              </div>
            </div>
          ) : (
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
                    name={p?.name ? (teamMode && teamMode !== "off" && typeof p.team === "number" ? `${p.name} (T${p.team + 1})` : p.name) : undefined}
                    color={p ? visualsForPlayer(p.color, p.id).base : undefined}
                    state={state}
                    statusText={statusText}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          {spectator ? (
            <>
              <div style={{ padding: "12px 16px", borderRadius: 16, background: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.9)", color: SURFACES.ink, fontWeight: 800, boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
                Watching as spectator
              </div>
              {canJoinAsPlayer ? (
                <>
                  <PrimaryPillButton label={roomEmpty ? "JOIN AS PLAYER (HOST)" : "JOIN AS PLAYER"} onClick={() => { play("ui.tap"); onBecomePlayer?.(); }} />
                  <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>
                    {roomEmpty ? "Take this empty room and become the host." : "A seat is available — join the match as a player."}
                  </div>
                </>
              ) : (
                <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>
                  {players.length >= maxPlayers ? "Room is full. You can keep watching until a seat opens." : "You can watch this room live. You won’t be able to make moves."}
                </div>
              )}
            </>
          ) : isHost ? (
            <>
              <PrimaryPillButton label="START GAME" onClick={onStart} disabled={players.length < 2} />
              <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>
                {players.length < 2 ? "Need at least 2 players to start" : `${players.length} player${players.length === 1 ? "" : "s"} ready · 1 min turns, ${gameTimeMinutes ?? 10} min game`}
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: "12px 16px", borderRadius: 16, background: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.9)", color: SURFACES.ink, fontWeight: 800, boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
                Waiting for host to start…
              </div>
              <div className="cw-caption" style={{ color: SURFACES.inkSoft }}>
                The game will begin once the host starts. Fixed 1-minute turns with a {gameTimeMinutes ?? 10}-minute overall timer.
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
