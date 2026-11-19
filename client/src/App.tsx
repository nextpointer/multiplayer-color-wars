import React, { useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig, useReducedMotion } from "motion/react";
import { applyMove, createGame, type Cell as GCell, type GameState } from "@game/shared";
import { SettingsProvider, useSettings } from "./state/settings";
import { ToastProvider, useToast } from "./design/Toast";
import { Modal } from "./design/Modal";
import { PrimaryPillButton } from "./design/PrimaryPillButton";
import { visualsForPlayer } from "./design/tokens";
import { play, haptic, unlockOnGesture } from "./design/sound";
import { deriveMovePlan, precomputeSnapshots, type MoveAnimationPlan } from "./engine/chainAdapter";
import { chooseBotMove, type BotDifficulty } from "./engine/bot";
import type { SvgFlightEngineHandle } from "./engine/svgFlight";
import { HomeFlow, SettingsRows } from "./screens/HomeFlow";
import { LobbyScreen } from "./screens/LobbyScreen";
import { GameScreen } from "./screens/GameScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { useConnectionQuality, type ConnQuality } from "./hooks/useConnectionQuality";

type PublicPlayer = { id: number; name: string; color: string; connected?: boolean; quality?: ConnQuality };

type ServerMsg =
  | { type: "room"; roomId: string; playerId: number; players: PublicPlayer[]; hostId: number; state: GameState }
  | { type: "state"; state: GameState; explosions?: { r: number; c: number; owner: number }[]; players?: PublicPlayer[] }
  | { type: "presence"; players: PublicPlayer[] }
  | { type: "error"; message: string }
  | { type: "pong"; ts?: number };

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
  const [lobbyPlayers, setLobbyPlayers] = useState<PublicPlayer[]>([]);
  const [serverState, setServerState] = useState<GameState | null>(null);
  const [displayState, setDisplayState] = useState<GameState | null>(null);
  const [homeView, setHomeView] = useState<"landing" | "howto" | "create" | "join" | "single">("landing");
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showQuit, setShowQuit] = useState(false);
  const [chainLocked, setChainLocked] = useState(false);
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());
  const [nudgeKey, setNudgeKey] = useState(0);
  const [bumpKeys, setBumpKeys] = useState<Record<number, number>>({});
  const [localMode, setLocalMode] = useState<{ difficulty: BotDifficulty; humanId: number; botId: number; humanName: string; botName: string } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const flightRef = useRef<SvgFlightEngineHandle | null>(null);
  const preMoveStateRef = useRef<GameState | null>(null);
  const pendingMoveRef = useRef<{ r: number; c: number } | null>(null);
  const prevTurnRef = useRef<number | null>(null);
  const displayStateRef = useRef<GameState | null>(null);
  const serverStateRef = useRef<GameState | null>(null);
  const metricsRef = useRef<{ cell: number; gap: number } | null>(null);
  const playMoveAnimationRef = useRef<((pre: GameState, plan: MoveAnimationPlan, nextState: GameState) => Promise<void>) | null>(null);
  const animTokenRef = useRef(0);
  const sessionRef = useRef<{ roomId: string; playerId: number; name: string } | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const intentionallyLeavingRef = useRef(false);
  const fatalReloadHandledRef = useRef(false);
  const animatingRef = useRef(false);
  const localModeRef = useRef<typeof localMode>(null);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conn = useConnectionQuality();

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("room") || params.get("roomId") || params.get("code") || "";
      const code = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 5);
      if (code) {
        setJoinCode(code);
        setHomeView("join");
        params.delete("room");
        params.delete("roomId");
        params.delete("code");
        const qs = params.toString();
        const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
        window.history.replaceState({}, "", next);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);
  useEffect(() => { serverStateRef.current = serverState; }, [serverState]);
  useEffect(() => { localModeRef.current = localMode; }, [localMode]);
  useEffect(() => { unlockOnGesture(); }, []);
  useEffect(() => () => { if (botTimerRef.current) clearTimeout(botTimerRef.current); }, []);

  const send = useCallback((obj: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const clearBotTimer = useCallback(() => {
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
  }, []);

  const bumpScore = useCallback((pid: number) => {
    setBumpKeys(prev => ({ ...prev, [pid]: (prev[pid] || 0) + 1 }));
  }, []);

  const resetGameView = useCallback(() => {
    clearBotTimer();
    animTokenRef.current++;
    animatingRef.current = false;
    try { flightRef.current?.clear(); } catch {}
    pendingMoveRef.current = null;
    preMoveStateRef.current = null;
    prevTurnRef.current = null;
    setChainLocked(false);
    setFlashCells(new Set());
    setBumpKeys({});
    setNudgeKey(0);
  }, [clearBotTimer]);

  const exitLocalMode = useCallback(() => {
    resetGameView();
    setLocalMode(null);
    localModeRef.current = null;
    sessionRef.current = null;
    setRoomId(null);
    setPlayerId(null);
    setHostId(null);
    setLobbyPlayers([]);
    setServerState(null);
    setDisplayState(null);
    setDisconnectedNotice(false);
    setShowQuit(false);
    setHomeView("landing");
  }, [resetGameView]);

  const startLocalGame = useCallback((difficulty: BotDifficulty) => {
    const humanName = (name || "Player").trim().slice(0, 20) || "Player";
    localStorage.setItem("cw.name", humanName);
    const botName = `CPU (${difficulty[0].toUpperCase()}${difficulty.slice(1)})`;
    const game = createGame([{ name: humanName }, { name: botName }]);
    const cfg = { difficulty, humanId: 0, botId: 1, humanName, botName };
    resetGameView();
    setLocalMode(cfg);
    localModeRef.current = cfg;
    setRoomId("LOCAL");
    setPlayerId(0);
    setHostId(0);
    setLobbyPlayers([
      { id: 0, name: humanName, color: game.players[0].color, connected: true, quality: "good" },
      { id: 1, name: botName, color: game.players[1].color, connected: true, quality: "good" },
    ]);
    setServerState(game);
    setDisplayState(game);
    preMoveStateRef.current = game;
    prevTurnRef.current = game.players[game.currentPlayerIndex]?.id ?? null;
    setShowQuit(false);
    setShowSettings(false);
    setDisconnectedNotice(false);
    sessionRef.current = null;
    void play("ui.tap");
    haptic("light");
  }, [name, resetGameView]);

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

    const token = ++animTokenRef.current;
    animatingRef.current = true;
    setChainLocked(true);
    const capMs = nextState.status === 'finished' ? 12_000 : 20_000;
    try {
      const run = engine.play(plan, {
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
        onWaveStart: (wi) => {
          if (token !== animTokenRef.current) return;
          // v2: do NOT clear the bursting cells — the engine's charge ball covers them
          // while it forms. Committing the plain snapshot keeps the incremented dots
          // visible, so the player sees the cell fill up BEFORE it explodes.
          setDisplayState(boardToState(snapshots[wi], nextState));
          void play("burst.pop");
          haptic("medium");
        },
        onWaveArrivals: (wi) => {
          if (token !== animTokenRef.current) return;
          const snap = snapshots[wi + 1];
          if (snap) setDisplayState(boardToState(snap, nextState)); // dots appear as resting dots
          void play("cascade.tick", { step: wi });
        },
      });
      await Promise.race([run, new Promise<void>((resolve) => setTimeout(resolve, capMs))]);
    } catch {
      // ignore animation errors and always apply final state if still current
    } finally {
      if (token === animTokenRef.current) {
        try { engine.clear(); } catch {}
        setDisplayState(nextState);            // authoritative final state, always
        preMoveStateRef.current = nextState;
        setChainLocked(false);
        animatingRef.current = false;
      }
    }
  }, [settings.chainSpeed, reduced]);

  const playLocalMoveInternal = useCallback(async (pre: GameState, moverId: number, r: number, c: number) => {
    const result = applyMove(pre, moverId, r, c);
    if (!result.ok || !result.state) {
      toast(result.error || "Invalid move");
      pendingMoveRef.current = null;
      setDisplayState(pre);
      preMoveStateRef.current = pre;
      return false;
    }
    const nextState = result.state;
    const explosions = result.explosions || [];
    const plan = deriveMovePlan({
      rows: pre.rows,
      cols: pre.cols,
      preBoard: pre.board,
      playerId: moverId,
      r, c,
      explosions,
    });

    if (nextState.status === "finished" && plan.waves.length > 0) {
      setServerState(pre);
    } else {
      setServerState(nextState);
    }

    await playMoveAnimation(pre, plan, nextState);
    // playMoveAnimation commits final state if this animation is still current.
    // If it was superseded, avoid forcing stale state.
    if (preMoveStateRef.current === nextState || animTokenRef.current >= 0) {
      // ensure canonical final state is applied for local flow
      setServerState(nextState);
      setDisplayState(nextState);
      preMoveStateRef.current = nextState;
    }
    bumpScore(moverId);
    return true;
  }, [playMoveAnimation, toast, bumpScore]);

  const scheduleBotMove = useCallback((baseState?: GameState) => {
    clearBotTimer();
    const cfg = localModeRef.current;
    if (!cfg) return;
    const st = baseState || serverStateRef.current;
    if (!st || st.status !== "playing") return;
    const cur = st.players[st.currentPlayerIndex];
    if (!cur || cur.id !== cfg.botId || !cur.alive) return;

    const delay = 350 + Math.floor(Math.random() * 350);
    botTimerRef.current = setTimeout(async () => {
      botTimerRef.current = null;
      const cfgNow = localModeRef.current;
      if (!cfgNow) return;
      let tries = 0;
      while (animatingRef.current && tries < 300) { await new Promise(r => setTimeout(r, 30)); tries++; }
      const live = serverStateRef.current;
      if (!localModeRef.current || !live || live.status !== "playing") return;
      const liveCur = live.players[live.currentPlayerIndex];
      if (!liveCur || liveCur.id !== cfgNow.botId || !liveCur.alive) return;

      const move = chooseBotMove(live, cfgNow.botId, cfgNow.difficulty);
      if (!move) return;
      preMoveStateRef.current = live;
      setDisplayState(withPlacement(live, move.r, move.c, cfgNow.botId));
      await playLocalMoveInternal(live, cfgNow.botId, move.r, move.c);
    }, delay);
  }, [clearBotTimer, playLocalMoveInternal]);

  useEffect(() => { playMoveAnimationRef.current = playMoveAnimation; }, [playMoveAnimation]);

  // auto-trigger bot turns in local mode
  useEffect(() => {
    if (!localMode) return;
    if (!serverState || serverState.status !== "playing") return;
    if (chainLocked || animatingRef.current) return;
    const cur = serverState.players[serverState.currentPlayerIndex];
    if (!cur || cur.id !== localMode.botId || !cur.alive) return;
    scheduleBotMove(serverState);
  }, [localMode, serverState?.status, serverState?.currentPlayerIndex, serverState?.turnCount, chainLocked, scheduleBotMove]);

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
        conn.onConnected();
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        const sendPing = () => {
          try {
            if (wsRef.current === ws && ws.readyState === WebSocket.OPEN) {
              const ts = performance.now();
              conn.markPingSent(ts);
              ws.send(JSON.stringify({ type: "ping", ts }));
            }
          } catch {}
        };
        sendPing();
        pingTimerRef.current = setInterval(sendPing, 5000);
        const s = sessionRef.current;
        if (s) {
          try { ws.send(JSON.stringify({ type: "rejoin", roomId: s.roomId, playerId: s.playerId, name: s.name })); } catch {}
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        setConnected(false);
        conn.onDisconnected();
        if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
        if (!intentionallyLeavingRef.current && !localModeRef.current) scheduleReconnect();
        if (localModeRef.current) setDisconnectedNotice(false);
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        if (!localModeRef.current) setDisconnectedNotice(true);
      };

      ws.onmessage = (ev) => {
        if (wsRef.current !== ws) return;
        let msg: ServerMsg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "pong") {
          const res = conn.onPong(msg.ts);
          if (res) {
            send({ type: "quality", quality: res.quality, rtt: res.rtt });
          }
          return;
        }
        if (msg.type === "presence") {
          conn.onPlayers(msg.players);
          setLobbyPlayers((prev) => prev.map(p => {
            const np = msg.players.find(x => x.id === p.id);
            return np ? { ...p, connected: np.connected, quality: np.quality } : p;
          }));
          return;
        }
        if (msg.type === "error") {
          const m = msg.message || "Error";
          // If rejoin/session is no longer valid, reset so user can start over.
          if (/room not found|player not found|lobby changed/i.test(m)) {
            if (fatalReloadHandledRef.current) return;
            fatalReloadHandledRef.current = true;
            sessionRef.current = null;
            toast(m);
            void play("error.thud");
            setTimeout(() => { window.location.reload(); }, 600);
            return;
          }
          // Suppress noisy/non-actionable connection-state spam.
          if (/join or create a room first/i.test(m)) {
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
          animTokenRef.current++;
          flightRef.current?.clear();
          pendingMoveRef.current = null;
          setChainLocked(false);
          setRoomId(msg.roomId);
          setPlayerId(msg.playerId);
          setHostId(msg.hostId);
          setLobbyPlayers(msg.players || []);
          if (msg.players) conn.onPlayers(msg.players);
          setServerState(msg.state);
          setDisplayState(msg.state);
          preMoveStateRef.current = msg.state;
          prevTurnRef.current = msg.state.players[msg.state.currentPlayerIndex]?.id ?? null;
          sessionRef.current = { roomId: msg.roomId, playerId: msg.playerId, name: (localStorage.getItem("cw.name") || name || "Player").trim() || "Player" };
          return;
        }
        if (msg.type === "state") {
          const prev = preMoveStateRef.current || displayStateRef.current || serverStateRef.current;
          const incomingPlayers = (msg.players ? msg.players : msg.state.players.map(p => ({
            id: p.id, name: p.name, color: p.color, connected: undefined as any, quality: undefined as any,
          }))) as PublicPlayer[];
          setLobbyPlayers((lpPrev) => {
            if (msg.players) return msg.players as any;
            return incomingPlayers.map((p) => {
              const old = lpPrev.find(x => x.id === p.id);
              return { ...p, connected: old?.connected, quality: old?.quality };
            }) as any;
          });
          if (msg.players) conn.onPlayers(msg.players);
          const pending = pendingMoveRef.current;
          pendingMoveRef.current = null;

          const applyImmediate = (s: GameState) => {
            animatingRef.current = false;
            animTokenRef.current++;
            flightRef.current?.clear();
            setServerState(s);
            setDisplayState(s);
            preMoveStateRef.current = s;
            setChainLocked(false);
            prevTurnRef.current = s.players[s.currentPlayerIndex]?.id ?? null;
          };

          const boardsEqual = (a: GameState, b: GameState) => {
            if (a.rows !== b.rows || a.cols !== b.cols) return false;
            for (let r = 0; r < a.rows; r++) for (let c = 0; c < a.cols; c++) {
              const ca = a.board[r][c], cb = b.board[r][c];
              if (ca.owner !== cb.owner || ca.count !== cb.count) return false;
            }
            return true;
          };

          // Fresh game/rematch or authoritative reset (e.g. after rejoin/rematch-to-lobby): apply immediately.
          const isFreshGame = msg.state.status === "playing" && msg.state.turnCount === 0 && (!msg.explosions || msg.explosions.length === 0);
          const statusChanged = !!prev && prev.status !== msg.state.status;
          if (isFreshGame || (statusChanged && msg.state.status === "waiting")) {
            applyImmediate(msg.state);
            return;
          }
          // If a player leaves/disconnects and game ends, stop any ongoing animation and show result immediately.
          if (msg.state.status === "finished" && statusChanged && (!msg.explosions || msg.explosions.length === 0) && animatingRef.current) {
            applyImmediate(msg.state);
            return;
          }

          // Timeout/turn-skip or authoritative sync with unchanged board: apply immediately.
          if (!msg.explosions?.length && prev && boardsEqual(prev, msg.state)) {
            applyImmediate(msg.state);
            return;
          }

          const findMoveByDiff = (a: GameState, b: GameState) => {
            if (a.rows !== b.rows || a.cols !== b.cols) return null;
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
            if (prev.rows !== msg.state.rows || prev.cols !== msg.state.cols) {
              applyImmediate(msg.state);
              return;
            }
            // Status transitions that aren't a playable move animation: apply immediately.
            if (prev.status !== msg.state.status && msg.state.status === "waiting") {
              applyImmediate(msg.state);
              return;
            }
            const moverId = prev.players[prev.currentPlayerIndex]?.id ?? 0;
            let move = pending;
            if (!move && msg.explosions && msg.explosions.length > 0) {
              move = { r: msg.explosions[0].r, c: msg.explosions[0].c };
            }
            if (!move) {
              move = findMoveByDiff(prev, msg.state);
            }
            if (!move) {
              // No identifiable move (e.g. player left and cells vanished). Apply authoritative state.
              if (animatingRef.current && msg.state.status === "playing") {
                // Out-of-band update during animation (rare). Stop and resync to avoid stale visuals.
                applyImmediate(msg.state);
              } else {
                applyImmediate(msg.state);
              }
              return;
            }
            const plan = deriveMovePlan({ rows: prev.rows, cols: prev.cols, preBoard: prev.board, playerId: moverId, r: move.r, c: move.c, explosions: msg.explosions || [] });
            if (plan.waves.length === 0 && prev.status !== msg.state.status) {
              // state changed without animation-worthy waves (e.g. removal leading to finish) - apply immediately
              // but still prefer showing final state; if finished we can just apply.
            }
            // If the game ends, keep showing/animating the final move before revealing results.
            if (msg.state.status === "finished" && plan.waves.length > 0) {
              setServerState(prev);
            } else {
              setServerState(msg.state);
            }
            const animPromise = (playMoveAnimationRef.current ?? playMoveAnimation)(prev, plan, msg.state);
            if (msg.state.status === "finished") {
              void animPromise.then(() => {
                if (serverStateRef.current?.status !== "playing" || serverStateRef.current?.turnCount !== 0) {
                  setServerState(msg.state);
                }
              });
            } else {
              void animPromise;
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
      if (cur === playerId) { void play("turn.you", { playerKey: seatOfPlayer(serverState.players[serverState.currentPlayerIndex]).key }); haptic("medium"); }
      else { void play("turn.other"); }
    }
    prevTurnRef.current = cur;
  }, [serverState?.currentPlayerIndex, serverState?.status, playerId]);

  // turn bg
  const current = serverState?.players[serverState.currentPlayerIndex];
  useEffect(() => {
    const seat = seatOfPlayer(current);
    document.documentElement.style.setProperty("--cw-turn-bg", seat.turnBg);
  }, [current?.id, current?.color]);

  const state = displayState || serverState;
  const myTurn = !!serverState && serverState.status === "playing" && playerId != null && current?.id === playerId && !chainLocked;

  const doCreate = (opts: { maxPlayers: number; grid: { rows: number; cols: number } | null }) => {
    if (!name.trim()) { toast("Enter your name"); return; }
    localStorage.setItem("cw.name", name.trim());
    void play("ui.tap"); haptic("light");
    const payload: any = { type: "create", name: name.trim(), maxPlayers: opts.maxPlayers };
    if (opts.grid) payload.grid = opts.grid;
    send(payload);
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
          onCreate={doCreate} onJoin={doJoin} onStartSingle={startLocalGame}
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
        maxPlayers={serverState.maxPlayers} rows={serverState.rows} cols={serverState.cols}
      />
    );
  }

  return (
    <>
      {disconnectedNotice && !localMode && (
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
            haptic("light");
            preMoveStateRef.current = state;
            pendingMoveRef.current = { r, c };
            setDisplayState(withPlacement(state, r, c, playerId));
            if (localModeRef.current) {
              void (async () => {
                const ok = await playLocalMoveInternal(state, playerId, r, c);
                if (!ok) return;
                const after = serverStateRef.current;
                if (after && after.status === "playing") {
                  const curId = after.players[after.currentPlayerIndex]?.id;
                  if (curId === localModeRef.current?.botId) scheduleBotMove(after);
                }
              })();
            } else {
              send({ type: "move", r, c });
            }
          }}
          onMetrics={(m) => { metricsRef.current = { cell: m.cell, gap: m.gap }; }}
          onQuit={() => setShowQuit(true)}
          onOpenSettings={() => setShowSettings(true)}
          settings={settings}
          playersConn={localMode ? {
            [localMode.humanId]: { connected: true, quality: "good" },
            [localMode.botId]: { connected: true, quality: "good" },
          } : conn.playersConn}
          myRtt={localMode ? null : conn.myRtt}
          myQuality={localMode ? "good" : conn.myQuality}
          connectionLabel={localMode ? "Local" : null}
        />
      )}
      {serverState.status === "finished" && (
        <ResultsScreen
          state={serverState} playerId={playerId} hostId={hostId}
          localMode={!!localMode}
          difficultyLabel={localMode ? (localMode.difficulty[0].toUpperCase() + localMode.difficulty.slice(1)) : undefined}
          onRematch={() => {
            void play("ui.tap");
            if (localMode) {
              startLocalGame(localMode.difficulty);
            } else {
              send({ type: "rematch" });
            }
          }}
          onLobby={() => {
            if (localMode) {
              exitLocalMode();
            } else {
              window.location.reload();
            }
          }}
        />
      )}
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Settings"><SettingsRows /></Modal>
      <Modal open={showQuit} onClose={() => setShowQuit(false)} title={localMode ? "Quit game?" : "Leave the match?"}>
        <div className="cw-body" style={{ color: "var(--cw-ink-soft)", marginBottom: 16 }}>
          {localMode ? "Return to the home screen." : "You'll give up your cells."}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => setShowQuit(false)} style={{ height: 48, padding: "0 24px", borderRadius: 999, border: "3px dashed var(--cw-ink-soft)", background: "transparent", color: "var(--cw-ink)", fontWeight: 700 }}>Stay</button>
          <PrimaryPillButton label={localMode ? "Home" : "Leave"} onClick={() => {
            setShowQuit(false);
            if (localMode) {
              exitLocalMode();
            } else {
              intentionallyLeavingRef.current = true;
              try { send({ type: "leave" }); } catch {}
              setTimeout(() => window.location.reload(), 120);
            }
          }} />
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
