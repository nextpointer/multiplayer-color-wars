import React, { useCallback, useEffect, useRef, useState } from "react";
import { MotionConfig, useReducedMotion } from "motion/react";
import { applyMove, createGame, criticalMass, finishGameByTime, getValidMoves, isGameTimeExpired, isPlayable, FIXED_TURN_MS, type Cell as GCell, type GameState } from "@game/shared";
import { SettingsProvider, useSettings } from "./state/settings";
import { ToastProvider, useToast } from "./design/Toast";
import { Modal } from "./design/Modal";
import { PrimaryPillButton } from "./design/PrimaryPillButton";
import { visualsForPlayer } from "./design/tokens";
import { play, haptic, unlockOnGesture } from "./design/sound";
import { deriveMovePlan, precomputeSnapshots, type MoveAnimationPlan } from "./engine/chainAdapter";
import { chooseBotMove, type BotDifficulty } from "./engine/bot";
import type { SvgFlightEngineHandle } from "./engine/svgFlight";
import { HomeFlow, SettingsRows, type HomeView } from "./screens/HomeFlow";
import { LobbyScreen } from "./screens/LobbyScreen";
import { GameScreen } from "./screens/GameScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { useConnectionQuality, type ConnQuality } from "./hooks/useConnectionQuality";

type PublicPlayer = { id: number; name: string; color: string; connected?: boolean; quality?: ConnQuality };

type ServerMsg =
  | { type: "room"; roomId: string; playerId: number; players: PublicPlayer[]; hostId: number; state: GameState; role?: "player" | "spectator"; spectatorId?: string; spectatorsCount?: number }
  | { type: "state"; state: GameState; explosions?: { r: number; c: number; owner: number }[]; players?: PublicPlayer[]; spectatorsCount?: number }
  | { type: "presence"; players: PublicPlayer[]; spectatorsCount?: number }
  | { type: "error"; message: string }
  | { type: "pong"; ts?: number };

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const host = (import.meta as any).env.VITE_WS_URL || `${proto}//${location.hostname}:3001`;
  return host.endsWith("/ws") ? host : `${host.replace(/\/$/, "")}/ws`;
}

function getClientId() {
  try {
    let id = localStorage.getItem("cw.clientId");
    if (!id) {
      id = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem("cw.clientId", id);
    }
    return id;
  } catch {
    return "anon";
  }
}
function getTabId() {
  try {
    let id = sessionStorage.getItem("cw.tabId");
    if (!id) {
      id = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      sessionStorage.setItem("cw.tabId", id);
    }
    return id;
  } catch {
    return "anon-tab";
  }
}
function loadSession(): { roomId: string; playerId: number; name: string } | null {
  try {
    const raw = localStorage.getItem("cw.session");
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.roomId !== "string" || !Number.isInteger(s.playerId)) return null;
    return { roomId: String(s.roomId).toUpperCase(), playerId: s.playerId, name: typeof s.name === "string" ? s.name : (localStorage.getItem("cw.name") || "Player") };
  } catch { return null; }
}
function saveSession(s: { roomId: string; playerId: number; name: string }) {
  try { localStorage.setItem("cw.session", JSON.stringify(s)); } catch {}
}
function clearSession() {
  try { localStorage.removeItem("cw.session"); } catch {}
}

type AppRoute =
  | { screen: "home"; view: HomeView }
  | { screen: "lobby" }
  | { screen: "game" };

const ROUTE_KEY = "cwRoute";
const LANDING_ROUTE: AppRoute = { screen: "home", view: "landing" };

function readRoute(): AppRoute | null {
  try {
    const route = (window.history.state as any)?.[ROUTE_KEY];
    if (!route || typeof route !== "object") return null;
    if (route.screen === "lobby" || route.screen === "game") return route;
    if (route.screen === "home" && typeof route.view === "string") return route;
    return null;
  } catch {
    return null;
  }
}

function writeRoute(mode: "push" | "replace", route: AppRoute, url?: string) {
  try {
    const state = { ...(window.history.state || {}), [ROUTE_KEY]: route };
    if (mode === "push") window.history.pushState(state, "", url);
    else window.history.replaceState(state, "", url);
  } catch {
    // history is best-effort; the app still works without it
  }
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

/** Optimistic placement, matching the server rule: empty cell -> 3 dots, own -> +1. */
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
  const [spectatorMode, setSpectatorMode] = useState(false);
  const [spectatorsCount, setSpectatorsCount] = useState(0);
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
  const [tossHighlightPlayerId, setTossHighlightPlayerId] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const flightRef = useRef<SvgFlightEngineHandle | null>(null);
  const preMoveStateRef = useRef<GameState | null>(null);
  const pendingMoveRef = useRef<{ r: number; c: number } | null>(null);
  const moveSendLockRef = useRef(false);
  const prevTurnRef = useRef<number | null>(null);
  const displayStateRef = useRef<GameState | null>(null);
  const serverStateRef = useRef<GameState | null>(null);
  const metricsRef = useRef<{ cell: number; gap: number } | null>(null);
  const playMoveAnimationRef = useRef<((pre: GameState, plan: MoveAnimationPlan, nextState: GameState) => Promise<void>) | null>(null);
  const animTokenRef = useRef(0);
  const sessionRef = useRef<{ roomId: string; playerId: number; name: string } | null>(loadSession());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const fatalReloadHandledRef = useRef(false);
  const routeRef = useRef<AppRoute>(LANDING_ROUTE);
  const historyReadyRef = useRef(false);
  const animatingRef = useRef(false);
  const localModeRef = useRef<typeof localMode>(null);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTurnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tossTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const tossActiveRef = useRef(false);
  const moveUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conn = useConnectionQuality();
  const runTossRef = useRef<(state: GameState) => void>(() => {});

  useEffect(() => {
    if (historyReadyRef.current) return;
    historyReadyRef.current = true;
    writeRoute("replace", LANDING_ROUTE);
  }, []);

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
        // Keep a clean landing entry beneath the prefilled join view so both
        // in-app Back and browser Back stay inside the app.
        writeRoute("replace", LANDING_ROUTE, next);
        writeRoute("push", { screen: "home", view: "join" });
        routeRef.current = { screen: "home", view: "join" };
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);
  useEffect(() => { serverStateRef.current = serverState; }, [serverState]);
  useEffect(() => { localModeRef.current = localMode; }, [localMode]);
  useEffect(() => { unlockOnGesture(); }, []);
  useEffect(() => () => {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    if (localTurnTimerRef.current) clearTimeout(localTurnTimerRef.current);
    if (moveUnlockTimerRef.current) clearTimeout(moveUnlockTimerRef.current);
    for (const t of tossTimersRef.current) clearTimeout(t);
  }, []);

  const lastActionAtRef = useRef<Record<string, number>>({});
  const actionGuard = useCallback((key: string, ms = 700) => {
    const now = Date.now();
    const last = lastActionAtRef.current[key] || 0;
    if (now - last < ms) return false;
    lastActionAtRef.current[key] = now;
    return true;
  }, []);

  const send = useCallback((obj: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const clearBotTimer = useCallback(() => {
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
  }, []);
  const clearLocalTurnTimer = useCallback(() => {
    if (localTurnTimerRef.current) { clearTimeout(localTurnTimerRef.current); localTurnTimerRef.current = null; }
  }, []);
  const clearToss = useCallback(() => {
    for (const t of tossTimersRef.current) clearTimeout(t);
    tossTimersRef.current = [];
    tossActiveRef.current = false;
    setTossHighlightPlayerId(null);
  }, []);
  const clearMoveUnlockTimer = useCallback(() => {
    if (moveUnlockTimerRef.current) { clearTimeout(moveUnlockTimerRef.current); moveUnlockTimerRef.current = null; }
  }, []);

  const bumpScore = useCallback((pid: number) => {
    setBumpKeys(prev => ({ ...prev, [pid]: (prev[pid] || 0) + 1 }));
  }, []);

  const resetGameView = useCallback(() => {
    clearBotTimer();
    clearLocalTurnTimer();
    clearToss();
    clearMoveUnlockTimer();
    animTokenRef.current++;
    animatingRef.current = false;
    moveSendLockRef.current = false;
    try { flightRef.current?.clear(); } catch {}
    pendingMoveRef.current = null;
    preMoveStateRef.current = null;
    prevTurnRef.current = null;
    setChainLocked(false);
    setFlashCells(new Set());
    setBumpKeys({});
    setNudgeKey(0);
    setDisplayState(null);
  }, [clearBotTimer, clearLocalTurnTimer, clearToss, clearMoveUnlockTimer]);

  const resetAppToHome = useCallback((view: HomeView = "landing") => {
    resetGameView();
    setLocalMode(null);
    localModeRef.current = null;
    setRoomId(null);
    setPlayerId(null);
    setHostId(null);
    setLobbyPlayers([]);
    setSpectatorMode(false);
    setSpectatorsCount(0);
    setServerState(null);
    setDisplayState(null);
    setDisconnectedNotice(false);
    setShowQuit(false);
    setShowSettings(false);
    setShowHelp(false);
    setHomeView(view);
  }, [resetGameView]);

  const enterRoomRoute = useCallback((screen: "lobby" | "game") => {
    if (routeRef.current.screen === screen) return;
    const next: AppRoute = screen === "lobby" ? { screen: "lobby" } : { screen: "game" };
    const hist = readRoute();
    // Replace the create/join entry so Back from a room lands on home; push a
    // new entry when a room is restored directly (reload/rejoin).
    if (hist?.screen === "home" && hist.view === "landing") writeRoute("push", next);
    else writeRoute("replace", next);
    routeRef.current = next;
  }, []);

  const leaveForHome = useCallback((view: HomeView = "landing", opts?: { fromPop?: boolean }) => {
    const current = routeRef.current;
    const wasLocal = !!localModeRef.current;
    if (!wasLocal && current.screen !== "home") {
      clearSession();
      sessionRef.current = null;
      try { send({ type: "leave" }); } catch {}
    }
    resetAppToHome(view);
    const next: AppRoute = { screen: "home", view };
    routeRef.current = next;
    if (opts?.fromPop) return;
    const hist = readRoute();
    if (hist && hist.screen !== "home") {
      try { window.history.back(); } catch { writeRoute("replace", next); }
    } else {
      writeRoute("replace", next);
    }
  }, [resetAppToHome, send]);

  const exitLocalMode = useCallback(() => {
    leaveForHome("landing");
  }, [leaveForHome]);

  const navigateHomeView = useCallback((view: HomeView) => {
    if (view === homeView) return;
    const hist = readRoute();
    const next: AppRoute = { screen: "home", view };
    if (view === "landing") {
      setHomeView("landing");
      routeRef.current = next;
      if (hist?.screen === "home" && hist.view !== "landing") {
        try { window.history.back(); } catch { writeRoute("replace", next); }
      } else {
        writeRoute("replace", next);
      }
      return;
    }
    // One history entry covers all home subviews; switching between them
    // replaces it instead of growing the stack.
    if (hist?.screen === "home" && hist.view === "landing") writeRoute("push", next);
    else writeRoute("replace", next);
    routeRef.current = next;
    setHomeView(view);
  }, [homeView]);

  const startLocalGame = useCallback((opts: { difficulty: BotDifficulty; grid: { rows: number; cols: number } | null; shape: string; gameTimeMinutes: 10 | 20 | 30 }) => {
    const humanName = (name || "Player").trim().slice(0, 20) || "Player";
    localStorage.setItem("cw.name", humanName);
    const botName = `CPU (${opts.difficulty[0].toUpperCase()}${opts.difficulty.slice(1)})`;
    const game = createGame([{ name: humanName }, { name: botName }], opts.grid?.rows, opts.grid?.cols, {
      shape: opts.shape as any,
      gameTimeMinutes: opts.gameTimeMinutes,
    });
    const now = Date.now();
    if (game.status === "playing") {
      game.turnDurationMs = FIXED_TURN_MS;
      game.turnDeadline = now + FIXED_TURN_MS;
      game.gameDurationMs = (opts.gameTimeMinutes || 10) * 60_000;
      game.gameDeadline = now + game.gameDurationMs;
    }
    const cfg = { difficulty: opts.difficulty, humanId: 0, botId: 1, humanName, botName };
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
    clearSession();
    enterRoomRoute("game");
    void play("ui.tap");
    haptic("light");
    // start toss after state is committed/rendered so no stale animation callbacks interfere
    setTimeout(() => {
      try { runTossRef.current(serverStateRef.current || game); } catch {}
    }, 0);
  }, [name, resetGameView, enterRoomRoute, clearSession]);

  const playMoveAnimation = useCallback(async (pre: GameState, plan: MoveAnimationPlan, nextState: GameState) => {
    const engine = flightRef.current;
    const m = metricsRef.current;
    const animQuality = settings.animationQuality || "full";
    const reducedAnim = reduced || animQuality === "reduced" || animQuality === "minimal";

    // nothing to animate (plain move without bursts) or engine/metrics missing:
    if (!engine || !m || plan.waves.length === 0) {
      setDisplayState(nextState);
      preMoveStateRef.current = nextState;
      setChainLocked(false);
      return;
    }

    // Minimal animations/perf mode: skip chain flight visuals and apply authoritative final state quickly.
    if (animQuality === "minimal") {
      const token = ++animTokenRef.current;
      animatingRef.current = true;
      setChainLocked(true);
      try {
        setDisplayState(nextState);
        preMoveStateRef.current = nextState;
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(120, 20 + plan.waves.length * 10)));
      } finally {
        if (token === animTokenRef.current) {
          try { engine.clear(); } catch {}
          setDisplayState(nextState);
          preMoveStateRef.current = nextState;
          setChainLocked(false);
          animatingRef.current = false;
        }
      }
      return;
    }

    const snapshots = precomputeSnapshots(pre.board, plan);
    const playerColors: Record<number, string> = {};
    for (const p of pre.players) playerColors[p.id] = p.color;
    const originColor = seatOfPlayer(pre.players[pre.currentPlayerIndex]).base;

    const token = ++animTokenRef.current;
    animatingRef.current = true;
    setChainLocked(true);
    const capMs = nextState.status === 'finished' ? (reducedAnim ? 8000 : 12_000) : (reducedAnim ? 12000 : 20_000);
    try {
      const run = engine.play(plan, {
        metrics: {
          cell: m.cell,
          gap: m.gap,
          boardW: pre.cols * m.cell + (pre.cols - 1) * m.gap,
          boardH: pre.rows * m.cell + (pre.rows - 1) * m.gap,
        },
        speed: reducedAnim ? "fast" : settings.chainSpeed,
        reduced: reducedAnim,
        originColor,
        snapshots,
        playerColors,
        onWaveStart: (wi) => {
          if (token !== animTokenRef.current) return;
          setDisplayState(boardToState(snapshots[wi], nextState));
          if (!reducedAnim) void play("burst.pop");
          if (!reducedAnim) haptic("medium");
        },
        onWaveArrivals: (wi) => {
          if (token !== animTokenRef.current) return;
          const snap = snapshots[wi + 1];
          if (snap) setDisplayState(boardToState(snap, nextState));
          if (!reducedAnim) void play("cascade.tick", { step: wi });
        },
      });
      await Promise.race([run, new Promise<void>((resolve) => setTimeout(resolve, capMs))]);
    } catch {
      // ignore animation errors and always apply final state if still current
    } finally {
      if (token === animTokenRef.current) {
        try { engine.clear(); } catch {}
        setDisplayState(nextState);
        preMoveStateRef.current = nextState;
        setChainLocked(false);
        animatingRef.current = false;
      }
    }
  }, [settings.chainSpeed, settings.animationQuality, reduced]);

  const playLocalMoveInternal = useCallback(async (pre: GameState, moverId: number, r: number, c: number) => {
    const result = applyMove(pre, moverId, r, c);
    if (!result.ok || !result.state) {
      if (result.state) {
        // e.g. game time expired produced a finished state
        setServerState(result.state);
        setDisplayState(result.state);
        preMoveStateRef.current = result.state;
      }
      toast(result.error || "Invalid move");
      pendingMoveRef.current = null;
      if (!result.state) {
        setDisplayState(pre);
        preMoveStateRef.current = pre;
      }
      return false;
    }
    const nextState = result.state;
    if (nextState.status === "playing") {
      nextState.turnDurationMs = FIXED_TURN_MS;
      nextState.turnDeadline = Date.now() + FIXED_TURN_MS;
      if (!nextState.gameDeadline && nextState.gameDurationMs) nextState.gameDeadline = Date.now() + nextState.gameDurationMs;
    } else {
      nextState.turnDeadline = null;
    }
    const explosions = result.explosions || [];
    const plan = deriveMovePlan({
      rows: pre.rows,
      cols: pre.cols,
      preBoard: pre.board,
      playerId: moverId,
      r, c,
      explosions,
      mask: pre.mask,
      players: pre.players,
      teamMode: pre.teamMode,
    });

    if (nextState.status === "finished" && plan.waves.length > 0) {
      setServerState(pre);
    } else {
      setServerState(nextState);
    }

    await playMoveAnimation(pre, plan, nextState);
    // playMoveAnimation commits final state if this animation is still current.
    if (preMoveStateRef.current === nextState || animTokenRef.current >= 0) {
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
    if (chainLocked || animatingRef.current || tossHighlightPlayerId != null) return;
    const cur = serverState.players[serverState.currentPlayerIndex];
    if (!cur || cur.id !== localMode.botId || !cur.alive) return;
    scheduleBotMove(serverState);
  }, [localMode, serverState?.status, serverState?.currentPlayerIndex, serverState?.turnCount, chainLocked, scheduleBotMove, tossHighlightPlayerId]);

  // local turn timeout (fixed 1 minute) and overall game timer
  useEffect(() => {
    clearLocalTurnTimer();
    if (!localMode) return;
    if (!serverState || serverState.status !== "playing") return;
    if (tossHighlightPlayerId != null || chainLocked) return;
    const turnSnapshot = { turnCount: serverState.turnCount, idx: serverState.currentPlayerIndex };
    const fire = async () => {
      localTurnTimerRef.current = null;
      if (tossActiveRef.current || animatingRef.current) return;
      const live = serverStateRef.current;
      if (!localModeRef.current || !live || live.status !== "playing") return;
      if (live.turnCount !== turnSnapshot.turnCount || live.currentPlayerIndex !== turnSnapshot.idx) return;
      if (isGameTimeExpired(live)) {
        const ended = finishGameByTime(live);
        setServerState(ended);
        setDisplayState(ended);
        preMoveStateRef.current = ended;
        return;
      }
      const liveCur = live.players[live.currentPlayerIndex];
      if (!liveCur || !liveCur.alive) return;
      const moves = getValidMoves(live, liveCur.id);
      if (moves.length === 0) return;
      const move = moves[Math.floor(Math.random() * moves.length)];
      preMoveStateRef.current = live;
      setDisplayState(withPlacement(live, move.r, move.c, liveCur.id));
      await playLocalMoveInternal(live, liveCur.id, move.r, move.c);
    };
    const now = Date.now();
    const turnMs = serverState.turnDeadline ? serverState.turnDeadline - now : Infinity;
    const gameMs = serverState.gameDeadline ? serverState.gameDeadline - now : Infinity;
    const ms = Math.min(turnMs, gameMs);
    if (!Number.isFinite(ms)) return;
    if (ms <= 0) { void fire(); return; }
    const t = setTimeout(() => { void fire(); }, ms + 40);
    localTurnTimerRef.current = t;
    return () => { clearTimeout(t); if (localTurnTimerRef.current === t) localTurnTimerRef.current = null; };
  }, [localMode, serverState?.status, serverState?.turnCount, serverState?.currentPlayerIndex, serverState?.turnDeadline, serverState?.gameDeadline, tossHighlightPlayerId, chainLocked, clearLocalTurnTimer, playLocalMoveInternal]);

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
          try { ws.send(JSON.stringify({ type: "rejoin", roomId: s.roomId, playerId: s.playerId, name: s.name, clientId: getClientId(), tabId: getTabId() })); } catch {}
        }
      };

      ws.onclose = (ev) => {
        if (wsRef.current !== ws) return;
        setConnected(false);
        conn.onDisconnected();
        if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
        if (ev.code === 4001) {
          // Another tab/reload took this seat over. Drop the stale session and return home.
          toast("This room is open in another tab");
          leaveForHome("landing");
          scheduleReconnect();
          return;
        }
        if (!localModeRef.current) scheduleReconnect();
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
          if (typeof (msg as any).spectatorsCount === "number") setSpectatorsCount((msg as any).spectatorsCount);
          setLobbyPlayers((prev) => prev.map(p => {
            const np = msg.players.find(x => x.id === p.id);
            return np ? { ...p, connected: np.connected, quality: np.quality } : p;
          }));
          return;
        }
        if (msg.type === "error") {
          const m = msg.message || "Error";
          // If rejoin/session is no longer valid, reset so user can start over.
          if (/room not found|player not found|lobby changed|already in/i.test(m)) {
            if (/already in/i.test(m)) {
              // keep session if server says already in room (we may need to rejoin), but surface error
              toast(m);
              void play("error.thud");
              return;
            }
            if (fatalReloadHandledRef.current) return;
            fatalReloadHandledRef.current = true;
            sessionRef.current = null;
            clearSession();
            toast(m);
            void play("error.thud");
            leaveForHome("landing");
            return;
          }
          // Suppress noisy/non-actionable connection-state spam.
          if (/join or create a room first/i.test(m)) {
            return;
          }
          // If server says we're already joined as this identity, try auto-rejoin from persisted session.
          if (/already joined this room/i.test(m)) {
            const s = sessionRef.current;
            if (s && connected) {
              toast("Rejoining room…");
              send({ type: "rejoin", roomId: s.roomId, playerId: s.playerId, name: s.name, clientId: getClientId(), tabId: getTabId() });
              return;
            }
          }
          toast(m);
          void play("error.thud");
          pendingMoveRef.current = null;
          moveSendLockRef.current = false;
          clearMoveUnlockTimer();
          if (serverStateRef.current) setDisplayState(serverStateRef.current);
          preMoveStateRef.current = serverStateRef.current;
          return;
        }
        if (msg.type === "room") {
          fatalReloadHandledRef.current = false;
          enterRoomRoute(msg.state?.status === "waiting" ? "lobby" : "game");
          animatingRef.current = false;
          animTokenRef.current++;
          flightRef.current?.clear();
          pendingMoveRef.current = null;
          moveSendLockRef.current = false;
          clearMoveUnlockTimer();
          setChainLocked(false);
          setRoomId(msg.roomId);
          setPlayerId(msg.role === "spectator" ? null : msg.playerId);
          setHostId(msg.hostId);
          const lp = (msg.players || []).map((p: any) => ({ ...p, team: msg.state?.players?.find((sp: any) => sp.id === p.id)?.team }));
          setLobbyPlayers(lp);
          setSpectatorMode(msg.role === "spectator");
          if (typeof msg.spectatorsCount === "number") setSpectatorsCount(msg.spectatorsCount);
          if (msg.players) conn.onPlayers(msg.players);
          setServerState(msg.state);
          setDisplayState(msg.state);
          preMoveStateRef.current = msg.state;
          prevTurnRef.current = msg.state.players[msg.state.currentPlayerIndex]?.id ?? null;
          if (msg.role !== "spectator") {
            const sess = { roomId: msg.roomId, playerId: msg.playerId, name: (localStorage.getItem("cw.name") || name || "Player").trim() || "Player" };
            sessionRef.current = sess;
            saveSession(sess);
          } else {
            sessionRef.current = null;
          }
          return;
        }
        if (msg.type === "state") {
          enterRoomRoute(msg.state.status === "waiting" ? "lobby" : "game");
          const prev = preMoveStateRef.current || displayStateRef.current || serverStateRef.current;
          const incomingPlayers = (msg.players ? msg.players : msg.state.players.map(p => ({
            id: p.id, name: p.name, color: p.color, connected: undefined as any, quality: undefined as any, team: (p as any).team,
          }))) as any[];
          setLobbyPlayers((lpPrev) => {
            if (msg.players) {
              return (msg.players as any[]).map(p => ({ ...p, team: msg.state?.players?.find((sp: any) => sp.id === p.id)?.team ?? (p as any).team }));
            }
            return incomingPlayers.map((p) => {
              const old = lpPrev.find(x => x.id === p.id);
              return { ...p, connected: old?.connected, quality: old?.quality, team: (p as any).team ?? msg.state?.players?.find((sp: any) => sp.id === p.id)?.team };
            }) as any;
          });
          if (msg.players) conn.onPlayers(msg.players);
          if (typeof (msg as any).spectatorsCount === "number") setSpectatorsCount((msg as any).spectatorsCount);
          const pending = pendingMoveRef.current;
          pendingMoveRef.current = null;
          moveSendLockRef.current = false;
          clearMoveUnlockTimer();

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
            resetGameView();
            applyImmediate(msg.state);
            if (isFreshGame) {
              try { runTossRef.current(msg.state); } catch {}
            }
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
            const plan = deriveMovePlan({ rows: prev.rows, cols: prev.cols, preBoard: prev.board, playerId: moverId, r: move.r, c: move.c, explosions: msg.explosions || [], mask: prev.mask, players: prev.players, teamMode: prev.teamMode });
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
            const animTokenUsed = animTokenRef.current;
            if (msg.state.status === "finished") {
              void animPromise.then(() => {
                // Only reveal results if this animation is still current and we haven't reset to a new game/rematch.
                if (animTokenRef.current !== animTokenUsed) return;
                const live = serverStateRef.current;
                if (live && (live.status === "waiting" || (live.status === "playing" && live.turnCount === 0))) return;
                setServerState(msg.state);
                setDisplayState(msg.state);
                preMoveStateRef.current = msg.state;
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

  // Browser Back/Forward stays inside the app. Subviews return to home, rooms
  // leave cleanly, and Back during a live match asks before abandoning it.
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const target = ((event.state as any)?.[ROUTE_KEY] || null) as AppRoute | null;
      const current = routeRef.current;

      if (!target) {
        if (current.screen !== "home" || current.view !== "landing") {
          writeRoute("push", current);
          if (current.screen === "game" && serverStateRef.current?.status === "playing") setShowQuit(true);
        }
        return;
      }

      const sameRoute = target.screen === "home" && current.screen === "home"
        ? target.view === current.view
        : target.screen === current.screen;
      if (sameRoute) return;

      if (current.screen === "game" && target.screen !== "game") {
        if (serverStateRef.current?.status === "playing") {
          // Restore the forward entry, then confirm before abandoning the match.
          try { window.history.forward(); } catch {}
          setShowQuit(true);
          return;
        }
        leaveForHome(target.screen === "home" ? target.view : "landing", { fromPop: true });
        return;
      }

      if (current.screen !== "home" && target.screen === "home") {
        leaveForHome(target.view, { fromPop: true });
        return;
      }

      if (target.screen !== "home" && current.screen === "home") {
        // Stale forward entry for a room that was already left.
        writeRoute("replace", current);
        return;
      }

      routeRef.current = target;
      if (target.screen === "home") setHomeView(target.view);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [leaveForHome]);

  // toss animation for first turn (no background changes during toss)
  useEffect(() => {
    runTossRef.current = (st: GameState) => {
      clearToss();
      if (st.status !== "playing" || st.turnCount !== 0 || st.players.length < 2) return;
      const finalId = st.players[st.currentPlayerIndex]?.id;
      if (finalId == null) return;
      tossActiveRef.current = true;
      const ids = st.players.map(p => p.id);
      let step = 0;
      const totalSteps = Math.max(10, ids.length * 4);
      const schedule = (delay: number) => {
        const t = setTimeout(() => {
          const idx = step % ids.length;
          setTossHighlightPlayerId(ids[idx]);
          try { void play("cascade.tick", { step }); } catch {}
          step++;
          if (step < totalSteps) {
            const progress = step / totalSteps;
            const nextDelay = 60 + Math.floor(progress * progress * 180);
            schedule(nextDelay);
          } else {
            const t2 = setTimeout(() => {
              setTossHighlightPlayerId(finalId);
              const t3 = setTimeout(() => {
                tossActiveRef.current = false;
                setTossHighlightPlayerId(null);
                // For local mode, reset turn/game deadlines so player gets full turn after toss
                if (localModeRef.current) {
                  setServerState(prev => {
                    if (!prev || prev.status !== "playing") return prev;
                    const now = Date.now();
                    const next = {
                      ...prev,
                      turnDurationMs: FIXED_TURN_MS,
                      turnDeadline: now + FIXED_TURN_MS,
                      gameDeadline: prev.gameDurationMs ? (prev.gameDeadline ?? (now + prev.gameDurationMs)) : prev.gameDeadline ?? null,
                    };
                    preMoveStateRef.current = next;
                    setDisplayState(next);
                    return next;
                  });
                }
              }, 450);
              tossTimersRef.current.push(t3);
            }, 120);
            tossTimersRef.current.push(t2);
          }
        }, delay);
        tossTimersRef.current.push(t);
      };
      schedule(60);
    };
  }, [clearToss]);

  // turn change sounds
  useEffect(() => {
    if (!serverState || serverState.status !== "playing") return;
    if (tossHighlightPlayerId != null) return;
    const cur = serverState.players[serverState.currentPlayerIndex]?.id;
    if (cur == null) return;
    if (prevTurnRef.current != null && prevTurnRef.current !== cur) {
      if (cur === playerId) { void play("turn.you", { playerKey: seatOfPlayer(serverState.players[serverState.currentPlayerIndex]).key }); haptic("medium"); }
      else { void play("turn.other"); }
    }
    prevTurnRef.current = cur;
  }, [serverState?.currentPlayerIndex, serverState?.status, playerId, tossHighlightPlayerId]);

  // turn bg (keep stable during toss - no background cycling)
  const current = serverState?.players[serverState.currentPlayerIndex];
  useEffect(() => {
    const seat = seatOfPlayer(current);
    document.documentElement.style.setProperty("--cw-turn-bg", seat.turnBg);
  }, [current?.id, current?.color]);

  const state = displayState || serverState;
  const tossing = tossHighlightPlayerId != null;
  const myTurn = !!serverState && serverState.status === "playing" && playerId != null && current?.id === playerId && !chainLocked && !tossing;

  const doCreate = (opts: { maxPlayers: number; grid: { rows: number; cols: number } | null; shape: string; gameTimeMinutes: 10 | 20 | 30; teamMode?: string }) => {
    if (!actionGuard("create", 1200)) return;
    if (!name.trim()) { toast("Enter your name"); return; }
    localStorage.setItem("cw.name", name.trim());
    void play("ui.tap"); haptic("light");
    const payload: any = { type: "create", name: name.trim(), maxPlayers: opts.maxPlayers, shape: opts.shape, gameTimeMinutes: opts.gameTimeMinutes, teamMode: opts.teamMode || "off", clientId: getClientId(), tabId: getTabId() };
    if (opts.grid) payload.grid = opts.grid;
    send(payload);
  };
  const doBecomePlayer = () => {
    if (!actionGuard("become_player", 1000)) return;
    void play("ui.tap");
    send({ type: "become_player", name: (name || "Player").trim() || "Player" });
  };
  const doJoin = () => {
    if (!actionGuard("join", 1000)) return;
    const code = joinCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (code.length < 5) { toast("Enter the room code"); void play("error.thud"); return; }
    if (!name.trim()) { toast("Enter your name"); return; }
    localStorage.setItem("cw.name", name.trim());
    void play("ui.tap");
    send({ type: "join", roomId: code, name: name.trim(), clientId: getClientId(), tabId: getTabId() });
  };
  const doSpectate = () => {
    if (!actionGuard("spectate", 1000)) return;
    const code = joinCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (code.length < 5) { toast("Enter the room code"); void play("error.thud"); return; }
    localStorage.setItem("cw.name", (name.trim() || "Spectator").slice(0,20));
    void play("ui.tap");
    send({ type: "spectate", roomId: code, name: (name.trim() || "Spectator").slice(0,20), clientId: getClientId(), tabId: getTabId() });
  };

  if (!roomId || !serverState || (playerId == null && !spectatorMode)) {
    return (
      <>
        <HomeFlow
          connected={connected} name={name} setName={setName} joinCode={joinCode} setJoinCode={setJoinCode}
          view={homeView} setView={navigateHomeView}
          onCreate={doCreate} onJoin={doJoin} onSpectate={doSpectate} onStartSingle={startLocalGame}
          onOpenSettings={() => setShowSettings(true)} onOpenHelp={() => { setShowHelp(true); }}
          showSettings={showSettings} setShowSettings={setShowSettings}
        />
        <Modal open={showHelp} onClose={() => setShowHelp(false)} title="How to play">
          <div style={{ display: "grid", gap: 10 }}>
            {[
              ["🎯", "Start", "Tap an empty cell to place your first dots."],
              ["➕", "Grow", "Then tap your own cells to add more dots."],
              ["💥", "Pop", "Full cells burst and capture neighbors in chain reactions."],
              ["👑", "Win", "Last color standing wins — or most dots when time runs out."],
            ].map(([e, t, d]) => (
              <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(66,50,76,0.05)", borderRadius: 14, padding: "10px 12px" }}>
                <div style={{ fontSize: 20, lineHeight: 1 }}>{e}</div>
                <div>
                  <div className="cw-body" style={{ fontWeight: 900, color: "var(--cw-ink)" }}>{t}</div>
                  <div className="cw-caption" style={{ color: "var(--cw-ink-soft)" }}>{d}</div>
                </div>
              </div>
            ))}
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
        roomId={roomId} players={lobbyPlayers} hostId={hostId} playerId={playerId ?? -1}
        onStart={spectatorMode ? () => {} : () => { if (!actionGuard("start", 1200)) return; void play("ui.tap"); send({ type: "start" }); }}
        onBecomePlayer={spectatorMode ? doBecomePlayer : undefined}
        onBack={() => leaveForHome("landing")}
        onOpenSettings={() => setShowSettings(true)}
        showSettings={showSettings} setShowSettings={setShowSettings}
        settings={settings} setMuted={setMuted} setHaptics={setHaptics} setChainSpeed={setChainSpeed}
        maxPlayers={serverState.maxPlayers} rows={serverState.rows} cols={serverState.cols}
        shape={serverState.shape} gameTimeMinutes={serverState.gameTimeMinutes} teamMode={(serverState as any).teamMode}
        spectator={spectatorMode} spectatorsCount={spectatorsCount}
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
          state={state} serverState={serverState} roomId={roomId} playerId={playerId ?? -1} hostId={hostId}
          myTurn={spectatorMode ? false : myTurn} chainLocked={chainLocked}
          flightRef={flightRef}
          flashCells={flashCells} nudgeKey={nudgeKey} bumpKeys={bumpKeys}
          tossHighlightPlayerId={tossHighlightPlayerId}
          spectator={spectatorMode} spectatorsCount={spectatorsCount}
          onMove={(r, c) => {
            if (spectatorMode) return;
            if (tossing || !myTurn || chainLocked || animatingRef.current || moveSendLockRef.current || pendingMoveRef.current || !state || playerId == null) return;
            if (!isPlayable(state, r, c)) return;
            const cell = state.board[r][c];
            const me = state.players.find(p => p.id === playerId);
            if (!me) return;
            if (!me.hasPlayed) {
              if (cell.owner !== null) return;
            } else {
              if (cell.owner !== playerId) return;
            }
            const placeCount = cell.count === 0 ? 3 : cell.count + 1;
            void play("dot.add", { dotCount: Math.min(4, placeCount) });
            haptic("light");
            preMoveStateRef.current = state;
            pendingMoveRef.current = { r, c };
            moveSendLockRef.current = true;
            setDisplayState(withPlacement(state, r, c, playerId));
            if (localModeRef.current) {
              void (async () => {
                try {
                  const ok = await playLocalMoveInternal(state, playerId, r, c);
                  if (!ok) return;
                  const after = serverStateRef.current;
                  if (after && after.status === "playing") {
                    const curId = after.players[after.currentPlayerIndex]?.id;
                    if (curId === localModeRef.current?.botId) scheduleBotMove(after);
                  }
                } finally {
                  pendingMoveRef.current = null;
                  moveSendLockRef.current = false;
                }
              })();
            } else {
              send({ type: "move", r, c });
              clearMoveUnlockTimer();
              moveUnlockTimerRef.current = setTimeout(() => {
                // Safety unlock if no authoritative response arrives; resync to last known server state.
                if (!moveSendLockRef.current && !pendingMoveRef.current) return;
                moveSendLockRef.current = false;
                pendingMoveRef.current = null;
                const ss = serverStateRef.current;
                if (ss) {
                  setDisplayState(ss);
                  preMoveStateRef.current = ss;
                }
              }, 12000);
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
          state={serverState} playerId={playerId ?? -1} hostId={hostId}
          localMode={!!localMode}
          spectator={spectatorMode}
          difficultyLabel={localMode ? (localMode.difficulty[0].toUpperCase() + localMode.difficulty.slice(1)) : undefined}
          onRematch={spectatorMode ? () => {} : () => {
            if (!actionGuard("rematch", 1200)) return;
            void play("ui.tap");
            if (localMode) {
              const st = serverStateRef.current || serverState;
              startLocalGame({
                difficulty: localMode.difficulty,
                grid: st ? { rows: st.rows, cols: st.cols } : null,
                shape: (st?.shape as any) || "rectangle",
                gameTimeMinutes: (st?.gameTimeMinutes as 10 | 20 | 30) || 10,
              });
            } else {
              send({ type: "rematch" });
            }
          }}
          onLobby={() => {
            if (localMode) {
              exitLocalMode();
            } else {
              leaveForHome("landing");
            }
          }}
        />
      )}
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Settings"><SettingsRows /></Modal>
      <Modal open={showQuit} onClose={() => setShowQuit(false)} title={localMode ? "Quit game?" : spectatorMode ? "Stop watching?" : "Leave the match?"}>
        <div className="cw-body" style={{ color: "var(--cw-ink-soft)", marginBottom: 16 }}>
          {localMode ? "Return to the home screen." : spectatorMode ? "Leave the spectator view and return to home." : "You'll give up your cells."}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => setShowQuit(false)} style={{ height: 48, padding: "0 24px", borderRadius: 999, border: "3px dashed var(--cw-ink-soft)", background: "transparent", color: "var(--cw-ink)", fontWeight: 700 }}>Stay</button>
          <PrimaryPillButton label={localMode ? "Home" : spectatorMode ? "Leave" : "Leave"} onClick={() => {
            setShowQuit(false);
            if (localMode) {
              exitLocalMode();
            } else {
              leaveForHome("landing");
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
