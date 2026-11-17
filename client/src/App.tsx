import React, { useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig, useReducedMotion } from "motion/react";
import { type Cell as GCell, type GameState } from "@game/shared";
import { SettingsProvider, useSettings } from "./state/settings";
import { ToastProvider, useToast } from "./design/Toast";
import { Modal } from "./design/Modal";
import { PrimaryPillButton } from "./design/PrimaryPillButton";
import { visualsForPlayer } from "./design/tokens";
import { play, haptic, unlockOnGesture } from "./design/sound";
import { deriveMovePlan, precomputeSnapshots, type MoveAnimationPlan } from "./engine/chainAdapter";
import type { SvgFlightEngineHandle } from "./engine/svgFlight";
import { HomeFlow, SettingsRows } from "./screens/HomeFlow";
import { LobbyScreen } from "./screens/LobbyScreen";
import { GameScreen } from "./screens/GameScreen";
import { ResultsScreen } from "./screens/ResultsScreen";

type ServerMsg =
  | { type: "room"; roomId: string; playerId: number; players: { id: number; name: string; color: string }[]; hostId: number; state: GameState }
  | { type: "state"; state: GameState; explosions?: { r: number; c: number; owner: number }[] }
  | { type: "error"; message: string }
  | { type: "pong" };

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

function boardToState(board: GCell[][], base: GameState): GameState {
  return { ...base, board };
}

/** Optimistic placement, matching the server rule: empty -> 3 dots, own -> +1. */
function withPlacement(base: GameState, r: number, c: number, playerId: number): GameState {
  const board = cloneBoard(base.board);
  const cell = board[r][c];
  board[r][c] = { owner: playerId, count: cell.count === 0 ? 3 : cell.count + 1 };
  return boardToState(board, base);
}

function AppInner() {
  const { settings, setMuted, setHaptics, setChainSpeed } = useSettings();
  const { show: toast } = useToast();
  const reduced = !!useReducedMotion();

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

  const wsRef = useRef<WebSocket | null>(null);
  const flightRef = useRef<SvgFlightEngineHandle | null>(null);
  const preMoveStateRef = useRef<GameState | null>(null);
  const pendingMoveRef = useRef<{ r: number; c: number } | null>(null);
  const prevTurnRef = useRef<number | null>(null);
  const displayStateRef = useRef<GameState | null>(null);
  const serverStateRef = useRef<GameState | null>(null);
  const metricsRef = useRef<{ cell: number; gap: number } | null>(null);
  const playMoveAnimationRef = useRef<((pre: GameState, plan: MoveAnimationPlan, nextState: GameState) => Promise<void>) | null>(null);
  const sessionRef = useRef<{ roomId: string; playerId: number; name: string } | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);

  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);
  useEffect(() => { serverStateRef.current = serverState; }, [serverState]);
  useEffect(() => { unlockOnGesture(); }, []);

  const send = useCallback((obj: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const playMoveAnimation = useCallback(async (pre: GameState, plan: MoveAnimationPlan, nextState: GameState) => {
    const engine = flightRef.current;
    const m = metricsRef.current;

    // nothing to animate (plain move without bursts) or engine/metrics missing:
    if (!engine || !m || plan.waves.length === 0) {
      setDisplayState(nextState);
      preMoveStateRef.current = nextState;
      setChainLocked(false);
      return;
    }

    const snapshots = precomputeSnapshots(pre.board, plan);
    const playerColors: Record<number, string> = {};
    for (const p of pre.players) playerColors[p.id] = p.color;
    const originColor = seatOfPlayer(pre.players[pre.currentPlayerIndex]).base;

    setChainLocked(true);
    try {
      await engine.play(plan, {
        metrics: {
          cell: m.cell,
          gap: m.gap,
          boardW: pre.cols * m.cell + (pre.cols - 1) * m.gap,
          boardH: pre.rows * m.cell + (pre.rows - 1) * m.gap,
        },
        speed: settings.chainSpeed,
        reduced,
        originColor,
        snapshots,
        playerColors,
        onWaveStart: (wi, wave) => {
          // v2: do NOT clear the bursting cells — the engine's charge ball covers them
          // while it forms. Committing the plain snapshot keeps the incremented dots
          // visible, so the player sees the cell fill up BEFORE it explodes.
          setDisplayState(boardToState(snapshots[wi], nextState));
          void play("burst.pop");
          if (settings.haptics) haptic("medium");
        },
        onWaveArrivals: (wi) => {
          const snap = snapshots[wi + 1];
          if (snap) setDisplayState(boardToState(snap, nextState)); // dots appear as resting dots
          void play("cascade.tick", { step: wi });
        },
      });
    } finally {
      setDisplayState(nextState);            // authoritative final state, always
      preMoveStateRef.current = nextState;
      setChainLocked(false);
    }
  }, [settings.chainSpeed, settings.haptics, reduced]);

  useEffect(() => { playMoveAnimationRef.current = playMoveAnimation; }, [playMoveAnimation]);

  useEffect(() => {
    shouldReconnectRef.current = true;

    const clearTimers = () => {
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
    };

    const scheduleReconnect = () => {
      if (!shouldReconnectRef.current) return;
      clearTimers();
      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      reconnectAttemptRef.current = Math.min(attempt + 1, 6);
      setDisconnectedNotice(true);
      reconnectTimerRef.current = setTimeout(() => { connect(); }, delay);
    };

    const connect = () => {
      if (!shouldReconnectRef.current) return;
      const old = wsRef.current;
      if (old) {
        old.onopen = null; old.onclose = null; old.onerror = null; old.onmessage = null;
        try { old.close(); } catch {}
      }
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        setConnected(true);
        setDisconnectedNotice(false);
        reconnectAttemptRef.current = 0;
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        pingTimerRef.current = setInterval(() => {
          try { if (wsRef.current === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })); } catch {}
        }, 20000);
        const s = sessionRef.current;
        if (s) {
          try { ws.send(JSON.stringify({ type: "rejoin", roomId: s.roomId, playerId: s.playerId, name: s.name })); } catch {}
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        setConnected(false);
        if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        setDisconnectedNotice(true);
      };

      ws.onmessage = (ev) => {
        if (wsRef.current !== ws) return;
        let msg: ServerMsg | { type: "pong" };
        try { msg = JSON.parse(ev.data); } catch { return; }
        if ((msg as any).type === "pong") return;
        if (msg.type === "error") {
          const m = msg.message || "Error";
          // If rejoin/session is no longer valid, reset so user can start over.
          if (/room not found|player not found|lobby changed/i.test(m)) {
            sessionRef.current = null;
            toast(m);
            void play("error.thud");
            setTimeout(() => { window.location.reload(); }, 600);
            return;
          }
          toast(m);
          void play("error.thud");
          pendingMoveRef.current = null;
          if (serverStateRef.current) setDisplayState(serverStateRef.current);
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
          sessionRef.current = { roomId: msg.roomId, playerId: msg.playerId, name: (localStorage.getItem("cw.name") || name || "Player").trim() || "Player" };
          return;
        }
        if (msg.type === "state") {
          const prev = preMoveStateRef.current || displayStateRef.current || serverStateRef.current;
          setLobbyPlayers(msg.state.players.map(p => ({ id: p.id, name: p.name, color: p.color })));
          const pending = pendingMoveRef.current;
          pendingMoveRef.current = null;

          const applyImmediate = (s: GameState) => {
            setServerState(s);
            setDisplayState(s);
            preMoveStateRef.current = s;
            setChainLocked(false);
          };

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
            applyImmediate(msg.state);
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
              applyImmediate(msg.state);
              return;
            }
            const plan = deriveMovePlan({ rows: prev.rows, cols: prev.cols, preBoard: prev.board, playerId: moverId, r: move.r, c: move.c, explosions: msg.explosions || [] });
            // If the game ends, keep showing/animating the final move before revealing results.
            if (msg.state.status === "finished" && plan.waves.length > 0) {
              setServerState(prev);
            } else {
              setServerState(msg.state);
            }
            const anim = (playMoveAnimationRef.current ?? playMoveAnimation)(prev, plan, msg.state);
            if (msg.state.status === "finished") {
              void anim.finally(() => { setServerState(msg.state); });
            } else {
              void anim;
            }
          } else {
            applyImmediate(msg.state);
          }
          return;
        }
      };
    };

    connect();
    return () => {
      shouldReconnectRef.current = false;
      clearTimers();
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = null; ws.onclose = null; ws.onerror = null; ws.onmessage = null;
        try { ws.close(); } catch {}
      }
      wsRef.current = null;
    };
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
            Try to occupy the whole field with your color. On your first turn, tap an empty cell to place your starting cell with 3 dots. After that, you can only tap your own cells to add 1 dot. When a cell's dots reach its neighbor count, it splits and adds 1 dot to each neighbor, capturing them. Last color standing wins!
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
        settings={settings} setMuted={setMuted} setHaptics={setHaptics} setChainSpeed={setChainSpeed}
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
          onMove={(r, c) => {
            if (!myTurn || chainLocked || !state || playerId == null) return;
            const cell = state.board[r][c];
            const me = state.players.find(p => p.id === playerId);
            if (!me) return;
            if (!me.hasPlayed) {
              if (cell.owner !== null) return;
            } else {
              if (cell.owner !== playerId) return;
            }
            void play("dot.add", { dotCount: Math.min(4, cell.count === 0 ? 3 : cell.count + 1) });
            if (settings.haptics) haptic("light");
            preMoveStateRef.current = state;
            pendingMoveRef.current = { r, c };
            setDisplayState(withPlacement(state, r, c, playerId));
            send({ type: "move", r, c });
          }}
          onMetrics={(m) => { metricsRef.current = { cell: m.cell, gap: m.gap }; }}
          onQuit={() => setShowQuit(true)}
          onOpenSettings={() => setShowSettings(true)}
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
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Settings"><SettingsRows /></Modal>
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

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <SettingsProvider>
        <ToastProvider>
          <AppInner />
        </ToastProvider>
      </SettingsProvider>
    </MotionConfig>
  );
}
