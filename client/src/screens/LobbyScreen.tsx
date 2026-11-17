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
  players: { id: number; name: string; color: string }[];
  hostId: number | null;
  playerId: number | null;
  onStart: () => void;
  onBack: () => void;
  onOpenSettings: () => void;
  showSettings: boolean; setShowSettings: (v: boolean) => void;
  settings: Settings;
  setMuted: (v:boolean)=>void; setHaptics:(v:boolean)=>void; setChainSpeed:(v:any)=>void; setTurnTimer:(v:boolean)=>void;
}) {
  const { roomId, players, hostId, playerId, onStart, onBack, showSettings, setShowSettings } = props;
  const { show: toast } = useToast();
  const isHost = hostId === playerId;
  const slots = Array.from({ length: Math.max(players.length, 2) }, (_, i) => players[i] || null);

  return (
    <div className="cw-page-shell cw-no-scrollbar" style={{ background: SURFACES.azure, position: "relative", overflowY: "auto" }}>
      <div style={{ background: SURFACES.plum, minHeight: 120, position: "relative", overflow: "hidden", padding: "16px" }}>
        <PlumPattern />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <IconButton variant="light" icon="back" ariaLabel="Back" onClick={() => { play("ui.back"); onBack(); }} />
          <div className="cw-h1" style={{ color: SURFACES.whiteText }}>Lobby</div>
          <RoomCodeChip code={roomId} onCopied={() => toast("Room code copied")} />
        </div>
      </div>
      <div style={{ padding: "20px 16px 140px", maxWidth: 720, margin: "0 auto", position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {slots.map((p, i) => (
            <PlayerSlot
              key={i}
              name={p?.name}
              color={p ? visualsForPlayer(p.color, p.id).base : undefined}
              state={!p ? "open" : p.id === hostId ? "host" : p.id === playerId ? "me" : "joined"}
              statusText={!p ? "Waiting…" : p.id === playerId ? "You" : (p.id === hostId ? "Host" : "Joined")}
            />
          ))}
        </div>
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          {isHost ? (
            <>
              <PrimaryPillButton label="START GAME" onClick={onStart} disabled={players.length < 2} />
              {players.length < 2 && <div className="cw-caption">Need at least 2 players</div>}
            </>
          ) : (
            <div className="cw-body" style={{ color: SURFACES.inkSoft }}>Waiting for host…</div>
          )}
        </div>
      </div>
      <CloudField />
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Settings"><SettingsRows /></Modal>
    </div>
  );
}
