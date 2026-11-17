import React, { useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { criticalMass, type Cell as GCell, type GameState } from "@game/shared";
import { SettingsProvider, useSettings } from "./state/settings";
import { ToastProvider, useToast } from "./design/Toast";
import { Modal } from "./design/Modal";
import { PrimaryPillButton } from "./design/PrimaryPillButton";
import { visualsForPlayer } from "./design/tokens";
import { play, haptic, unlockOnGesture } from "./design/sound";
import { deriveMovePlan, precomputeSnapshots, type MoveAnimationPlan } from "./engine/chainAdapter";
import type { SvgFlightEngineHandle } from "./engine/svgFlight";
import { HomeFlow } from "./screens/HomeFlow";
import { LobbyScreen } from "./screens/LobbyScreen";
import { GameScreen } from "./screens/GameScreen";
import { ResultsScreen } from "./screens/ResultsScreen";

type ServerMsg =
  | { type: "room"; roomId: string; playerId: number; players: { id: number; name: string; color: string }[]; hostId: number; state: GameState }
  | { type: "state"; state: GameState; explosions?: { r: number; c: number; owner: number }[] }
  | { type: "error"; message: string };

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const host = (import.meta as any).env.VITE_WS_URL || `${proto}//${location.hostname}:3001`;
  return host.endsWith("/ws") ? host : `${host.replace(/\/$/, "")}/ws`;
}

function seatOfPlayer(p?: { id: number; color: string } | null) {
  if (!p) return visualsForPlayer("#00C2EE", 0);
  return visualsForPlayer(p.color, p.id);
}

function cloneBoard(board: GCell[][]): GCell[][] {
  return board.map(row => row.map(c => ({ owner: c.owner, count: c.count })));
}

function AppInner() {
  const { settings, setMuted, setHaptics, setChainSpeed, setTurnTimer } = useSettings();
  const { show: toast } = useToast();

  const [connected, setConnected] = useState(false);
  const [disconnectedNotice, setDisconnectedNotice] = useState(false);
  const [name, setName] = useState(() => localStorage.getItem("cw.name") || "");
  const [joinCode, setJoinCode] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [hostId, setHostId] = useState<number | null>(null);
  const [lobbyPlayers, setLobbyPlayers] = useState<{ id: number; name: string; color: string }[]>([]);
  const [serverState, setServerState] = useState<GameState | null>(null);
  const [displayState, setDisplayState] = useState<GameState | null>(null);
  const [homeView, setHomeView] = useState<"landing" | "howto" | "create" | "join">("landing");
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showQuit, setShowQuit] = useState(false);
  const [chainLocked, setChainLocked] = useState(false);
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());
  const [nudgeKey, setNudgeKey] = useState(0);
  const [bumpKeys, setBumpKeys] = useState<Record<number, number>>({});
  const [turnSecondsLeft, setTurnSecondsLeft] = useState(15);

  const wsRef = useRef<WebSocket | null>(null);
  const flightRef = useRef<SvgFlightEngineHandle | null>(null);
  const preMoveStateRef = useRef<GameState | null>(null);
  const pendingMoveRef = useRef<{ r: number; c: number } | null>(null);
  const prevTurnRef = useRef<number | null>(null);
  const displayStateRef = useRef<GameState | null>(null);
  const serverStateRef = useRef<GameState | null>(null);

  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);
  useEffect(() => { serverStateRef.current = serverState; }, [serverState]);
  useEffect(() => { unlockOnGesture(); }, []);

  const send = useCallback((obj: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const playMoveAnimation = useCallback(async (_pre: GameState, _plan: MoveAnimationPlan, nextState: GameState) => {
    // No explosion/move animation: apply authoritative result immediately.
    setDisplayState(nextState);
    preMoveStateRef.current = nextState;
    setChainLocked(false);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;
    ws.onopen = () => { setConnected(true); setDisconnectedNotice(false); };
    ws.onclose = () => { setConnected(false); setDisconnectedNotice(true); };
    ws.onerror = () => { setDisconnectedNotice(true); toast("Connection error. Reconnecting…"); void play("error.thud"); };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "error") {
        toast(msg.message);
        void play("error.thud");
        pendingMoveRef.current = null;
        preMoveStateRef.current = serverStateRef.current;
        return;
      }
      if (msg.type === "room") {
        setRoomId(msg.roomId);
        setPlayerId(msg.playerId);
        setHostId(msg.hostId);
        setLobbyPlayers(msg.players);
        setServerState(msg.state);
        setDisplayState(msg.state);
        preMoveStateRef.current = msg.state;
        prevTurnRef.current = msg.state.players[msg.state.currentPlayerIndex]?.id ?? null;
        return;
      }
      if (msg.type === "state") {
        const prev = preMoveStateRef.current || displayStateRef.current || serverStateRef.current;
        setServerState(msg.state);
        setLobbyPlayers(msg.state.players.map(p => ({ id: p.id, name: p.name, color: p.color })));
        const pending = pendingMoveRef.current;
        pendingMoveRef.current = null;

        const boardsEqual = (a: GameState, b: GameState) => {
          if (a.rows !== b.rows || a.cols !== b.cols) return false;
          for (let r = 0; r < a.rows; r++) for (let c = 0; c < a.cols; c++) {
            const ca = a.board[r][c], cb = b.board[r][c];
            if (ca.owner !== cb.owner || ca.count !== cb.count) return false;
          }
          return true;
        };

        // Timeout/turn-skip or authoritative sync with unchanged board: apply immediately.
        if (!msg.explosions?.length && prev && boardsEqual(prev, msg.state)) {
          flightRef.current?.clear();
          setDisplayState(msg.state);
          preMoveStateRef.current = msg.state;
          setChainLocked(false);
          return;
        }

        const findMoveByDiff = (a: GameState, b: GameState) => {
          for (let r = 0; r < a.rows; r++) for (let c = 0; c < a.cols; c++) {
            const ca = a.board[r][c], cb = b.board[r][c];
            if (cb.count === ca.count + 1 && (ca.owner === null || ca.owner === cb.owner)) {
              if (!msg.explosions || msg.explosions.length === 0) return { r, c };
            }
          }
          for (let r = 0; r < a.rows; r++) for (let c = 0; c < a.cols; c++) {
            if (b.board[r][c].count > a.board[r][c].count) return { r, c };
          }
          return null;
        };

        if (prev) {
          const moverId = prev.players[prev.currentPlayerIndex]?.id ?? 0;
          let move = pending;
          if (!move && msg.explosions && msg.explosions.length > 0) {
            move = { r: msg.explosions[0].r, c: msg.explosions[0].c };
          }
          if (!move) {
            move = findMoveByDiff(prev, msg.state);
          }
          if (!move) {
            setDisplayState(msg.state);
            preMoveStateRef.current = msg.state;
            setChainLocked(false);
            return;
          }
          const plan = deriveMovePlan({ rows: prev.rows, cols: prev.cols, preBoard: prev.board, playerId: moverId, r: move.r, c: move.c, explosions: msg.explosions || [] });
          void playMoveAnimation(prev, plan, msg.state);
        } else {
          setDisplayState(msg.state);
          preMoveStateRef.current = msg.state;
        }
        return;
      }
    };
    return () => ws.close();
  }, []); // eslint-disable-line

  // turn change sounds
  useEffect(() => {
    if (!serverState || serverState.status !== "playing") return;
    const cur = serverState.players[serverState.currentPlayerIndex]?.id;
    if (cur == null) return;
    if (prevTurnRef.current != null && prevTurnRef.current !== cur) {
      if (cur === playerId) { void play("turn.you", { playerKey: seatOfPlayer(serverState.players[serverState.currentPlayerIndex]).key }); if (settings.haptics) haptic("medium"); }
      else { void play("turn.other"); }
    }
    prevTurnRef.current = cur;
  }, [serverState?.currentPlayerIndex, serverState?.status, playerId, settings.haptics]);

  // turn bg
  const current = serverState?.players[serverState.currentPlayerIndex];
  useEffect(() => {
    const seat = seatOfPlayer(current);
    document.documentElement.style.setProperty("--cw-turn-bg", seat.turnBg);
  }, [current?.id, current?.color]);

  const state = displayState || serverState;
  const myTurn = !!serverState && serverState.status === "playing" && playerId != null && current?.id === playerId && !chainLocked;

  useEffect(() => {
    if (!serverState || serverState.status !== "playing" || !settings.turnTimer) { setTurnSecondsLeft(15); return; }
    setTurnSecondsLeft(15);
    const id = window.setInterval(() => {
      setTurnSecondsLeft(s => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [serverState?.currentPlayerIndex, serverState?.status, serverState?.turnCount, settings.turnTimer, chainLocked]);

  // When timer ends: server controls turns (no pass/skip protocol). Notify player if it's their turn.
  useEffect(() => {
    if (!settings.turnTimer || turnSecondsLeft !== 0) return;
    if (serverState?.status === "playing" && myTurn) {
      toast("Time's up");
    }
  }, [turnSecondsLeft, settings.turnTimer, myTurn, serverState?.status]);

  const doCreate = () => {
    if (!name.trim()) { toast("Enter your name"); return; }
    localStorage.setItem("cw.name", name.trim());
    void play("ui.tap"); if (settings.haptics) haptic("light");
    send({ type: "create", name: name.trim() });
  };
  const doJoin = () => {
    const code = joinCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (code.length < 5) { toast("Enter the room code"); void play("error.thud"); return; }
    if (!name.trim()) { toast("Enter your name"); return; }
    localStorage.setItem("cw.name", name.trim());
    void play("ui.tap");
    send({ type: "join", roomId: code, name: name.trim() });
  };

  if (!roomId || !serverState || playerId == null) {
    return (
      <>
        <HomeFlow
          connected={connected} name={name} setName={setName} joinCode={joinCode} setJoinCode={setJoinCode}
          view={homeView} setView={setHomeView}
          onCreate={doCreate} onJoin={doJoin}
          onOpenSettings={() => setShowSettings(true)} onOpenHelp={() => { setShowHelp(true); }}
          showSettings={showSettings} setShowSettings={setShowSettings}
        />
        <Modal open={showHelp} onClose={() => setShowHelp(false)} title="How to play">
          <div className="cw-body" style={{ whiteSpace: "pre-wrap" }}>
            Try to occupy the whole field with your color. Tap your circles to grow them. When a circle reaches 4 white dots, it bursts and its dots fly into the neighbouring squares, capturing them. Last color standing wins!
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
            <PrimaryPillButton label="Got it" onClick={() => setShowHelp(false)} />
          </div>
        </Modal>
      </>
    );
  }

  if (serverState.status === "waiting") {
    return (
      <LobbyScreen
        roomId={roomId} players={lobbyPlayers} hostId={hostId} playerId={playerId}
        onStart={() => { void play("ui.tap"); send({ type: "start" }); }}
        onBack={() => { window.location.reload(); }}
        onOpenSettings={() => setShowSettings(true)}
        showSettings={showSettings} setShowSettings={setShowSettings}
        settings={settings} setMuted={setMuted} setHaptics={setHaptics} setChainSpeed={setChainSpeed} setTurnTimer={setTurnTimer}
      />
    );
  }

  return (
    <>
      {disconnectedNotice && (
        <div style={{ position: "fixed", top: "calc(env(safe-area-inset-top) + 8px)", left: "50%", transform: "translateX(-50%)", zIndex: 70, background: "var(--cw-pill)", color: "#fff", padding: "8px 14px", borderRadius: 999, fontWeight: 700, fontSize: 14 }}>
          Reconnecting…
        </div>
      )}
      {state && (
        <GameScreen
          state={state} serverState={serverState} roomId={roomId} playerId={playerId} hostId={hostId}
          myTurn={myTurn} chainLocked={chainLocked}
          flightRef={flightRef}
          flashCells={flashCells} nudgeKey={nudgeKey} bumpKeys={bumpKeys}
          turnSecondsLeft={settings.turnTimer ? turnSecondsLeft : null}
          onMove={(r, c) => {
            if (!myTurn || chainLocked || !state) return;
            const cell = state.board[r][c];
            if (cell.owner !== null && cell.owner !== playerId) return;
            void play("dot.add", { dotCount: Math.min(4, cell.count + 1) });
            if (settings.haptics) haptic("light");
            preMoveStateRef.current = state;
            pendingMoveRef.current = { r, c };
            send({ type: "move", r, c });
          }}
          onQuit={() => setShowQuit(true)}
          settings={settings}
        />
      )}
      {serverState.status === "finished" && (
        <ResultsScreen
          state={serverState} playerId={playerId} hostId={hostId}
          onRematch={() => { void play("ui.tap"); send({ type: "rematch" }); }}
          onLobby={() => window.location.reload()}
        />
      )}
      <Modal open={showQuit} onClose={() => setShowQuit(false)} title="Leave the match?">
        <div className="cw-body" style={{ color: "var(--cw-ink-soft)", marginBottom: 16 }}>You'll give up your cells.</div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => setShowQuit(false)} style={{ height: 48, padding: "0 24px", borderRadius: 999, border: "3px dashed var(--cw-ink-soft)", background: "transparent", color: "var(--cw-ink)", fontWeight: 700 }}>Stay</button>
          <PrimaryPillButton label="Leave" onClick={() => { setShowQuit(false); window.location.reload(); }} />
        </div>
      </Modal>
    </>
  );
}

function PhoneLandscape({ children }: { children: React.ReactNode }) {
  const [force, setForce] = useState(() => window.innerWidth < window.innerHeight && window.innerWidth < 900);
  const [dims, setDims] = useState(() => ({ w: window.innerHeight, h: window.innerWidth }));
  useEffect(() => {
    const on = () => {
      const f = window.innerWidth < window.innerHeight && window.innerWidth < 900;
      setForce(f);
      setDims({ w: window.innerHeight, h: window.innerWidth });
    };
    on();
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("orientationchange", on); };
  }, []);
  if (!force) return <>{children}</>;
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "var(--cw-turn-bg, #E7F4FC)" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "100%",
          width: dims.w,
          height: dims.h,
          transform: "rotate(90deg)",
          transformOrigin: "top left",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <SettingsProvider>
        <ToastProvider>
          <PhoneLandscape>
            <AppInner />
          </PhoneLandscape>
        </ToastProvider>
      </SettingsProvider>
    </MotionConfig>
  );
}
