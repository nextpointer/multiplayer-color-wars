import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import type { WSContext } from 'hono/ws';
import {
  applyMove,
  createGame,
  finishGameByTime,
  getValidMoves,
  isGameTimeExpired,
  isValidTeamModeForPlayers,
  normalizeBoardShape,
  normalizeGridChoice,
  normalizeGameTimeMinutes,
  normalizeTeamMode,
  removePlayerCells,
  turnDurationMsFor,
  gameDurationMsFor,
  FIXED_TURN_MS,
  type BoardShape,
  type GameState,
  type GameTimeMinutes,
  type GridSize,
  PLAYER_COLORS,
} from '@game/shared';

type ConnQuality = 'good' | 'ok' | 'bad' | 'offline';

type ClientMsg =
  | { type: 'create'; name: string; maxPlayers?: number; grid?: { rows: number; cols: number } | null; shape?: string; gameTimeMinutes?: number | string; teamMode?: string; clientId?: string; tabId?: string }
  | { type: 'join'; roomId: string; name: string; clientId?: string; tabId?: string }
  | { type: 'rejoin'; roomId: string; playerId: number; name?: string; clientId?: string; tabId?: string }
  | { type: 'spectate'; roomId: string; name?: string; clientId?: string; tabId?: string }
  | { type: 'become_player'; name?: string }
  | { type: 'start' }
  | { type: 'move'; r: number; c: number }
  | { type: 'rematch' }
  | { type: 'leave' }
  | { type: 'ping'; ts?: number }
  | { type: 'quality'; quality: ConnQuality; rtt?: number };

type PublicPlayer = { id: number; name: string; color: string; connected: boolean; quality: ConnQuality };

type ServerMsg =
  | { type: 'room'; roomId: string; playerId: number; players: PublicPlayer[]; hostId: number; state: GameState; role?: 'player' | 'spectator'; spectatorId?: string; spectatorsCount?: number }
  | { type: 'state'; state: GameState; explosions?: { r: number; c: number; owner: number }[]; players?: PublicPlayer[]; spectatorsCount?: number }
  | { type: 'presence'; players: PublicPlayer[]; spectatorsCount?: number }
  | { type: 'error'; message: string }
  | { type: 'pong'; ts?: number };

interface RoomPlayer {
  id: number;
  name: string;
  color: string;
  clientId?: string;
  tabId?: string;
  ws: WSContext | null;
  connected: boolean;
  quality: ConnQuality;
  rtt: number | null;
  lastSeen: number;
  removed: boolean; // left/removed from active play
}

interface Spectator {
  id: string;
  name: string;
  clientId?: string;
  ws: WSContext | null;
  connected: boolean;
  tabId?: string;
}

interface Room {
  id: string;
  hostId: number;
  players: RoomPlayer[];
  spectators: Spectator[];
  state: GameState;
  turnTimer?: ReturnType<typeof setTimeout> | null;
  gameTimer?: ReturnType<typeof setTimeout> | null;
  turnToken: number;
  turnKey: string | null;
  chosenGrid: GridSize | null;
  maxPlayers: number;
  shape: BoardShape;
  gameTimeMinutes: GameTimeMinutes;
  teamMode: 'off' | '2v2' | '3v3';
}

const rooms = new Map<string, Room>();

type SessionState = {
  room: Room | null;
  playerId: number | null;
  role: 'player' | 'spectator' | null;
  spectatorId: string | null;
};

const sessionByWs = new WeakMap<object, SessionState>();

function turnKeyOf(state: GameState): string | null {
  if (state.status !== 'playing') return null;
  const cur = state.players[state.currentPlayerIndex];
  if (!cur || !cur.alive) return null;
  return `${state.turnCount}:${state.currentPlayerIndex}:${cur.id}`;
}

function makeId(len = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function send(ws: WSContext | null | undefined, msg: ServerMsg) {
  try { ws?.send(JSON.stringify(msg)); } catch {}
}

function publicPlayers(room: Room): PublicPlayer[] {
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    connected: p.connected,
    quality: p.connected ? p.quality : 'offline',
  }));
}

function spectatorsCount(room: Room) {
  return room.spectators.filter(s => s.connected && s.ws).length;
}

function broadcast(room: Room, msg: ServerMsg) {
  const withCount = (msg.type === 'state' || msg.type === 'presence') ? { ...msg, spectatorsCount: spectatorsCount(room) } as ServerMsg : msg;
  for (const p of room.players) {
    if (p.connected && p.ws) send(p.ws, withCount);
  }
  for (const s of room.spectators) {
    if (s.connected && s.ws) send(s.ws, withCount);
  }
}

function broadcastPresence(room: Room) {
  broadcast(room, { type: 'presence', players: publicPlayers(room) });
}

function roomPayload(room: Room, playerId: number, opts?: { role?: 'player' | 'spectator'; spectatorId?: string }): ServerMsg {
  return {
    type: 'room',
    roomId: room.id,
    playerId,
    players: publicPlayers(room),
    hostId: room.hostId,
    state: room.state,
    role: opts?.role || 'player',
    ...(opts?.spectatorId ? { spectatorId: opts.spectatorId } : {}),
    spectatorsCount: spectatorsCount(room),
  };
}

function broadcastRoom(room: Room) {
  for (const p of room.players) {
    if (p.connected && p.ws) send(p.ws, roomPayload(room, p.id, { role: 'player' }));
  }
  for (const s of room.spectators) {
    if (s.connected && s.ws) send(s.ws, roomPayload(room, -1, { role: 'spectator', spectatorId: s.id }));
  }
}

function lobbyState(room: Room): GameState {
  const base = createGame(room.players.map((p) => ({ name: p.name })), room.chosenGrid?.rows, room.chosenGrid?.cols, {
    shape: room.shape,
    gameTimeMinutes: room.gameTimeMinutes,
    maxPlayers: room.maxPlayers,
    teamMode: room.teamMode,
  });
  // createGame sets playing/random first turn when >=2 players; lobby must be waiting
  return {
    ...base,
    status: 'waiting',
    winner: null,
    turnCount: 0,
    currentPlayerIndex: 0,
    turnDeadline: null,
    gameDeadline: null,
    gameTimeMinutes: room.gameTimeMinutes,
    gameDurationMs: gameDurationMsFor(room.gameTimeMinutes),
    turnDurationMs: FIXED_TURN_MS,
  };
}

function clearTurnTimer(room: Room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnToken++;
  room.turnKey = null;
}

function clearGameTimer(room: Room) {
  if (room.gameTimer) {
    clearTimeout(room.gameTimer);
    room.gameTimer = null;
  }
}

function clearAllTimers(room: Room) {
  clearTurnTimer(room);
  clearGameTimer(room);
}

function currentTurnDurationMs(room: Room): number {
  room.state.turnDurationMs = FIXED_TURN_MS;
  return FIXED_TURN_MS;
}

function stampGameTiming(room: Room) {
  room.state.gameTimeMinutes = room.gameTimeMinutes;
  room.state.gameDurationMs = gameDurationMsFor(room.gameTimeMinutes);
  if (room.state.status === 'playing') {
    if (!room.state.gameDeadline) room.state.gameDeadline = Date.now() + room.state.gameDurationMs;
  } else {
    room.state.gameDeadline = null;
  }
}

function stampTurnTiming(room: Room) {
  const d = currentTurnDurationMs(room);
  if (room.state.status === 'playing') {
    room.state.turnDeadline = Date.now() + d;
  } else {
    room.state.turnDeadline = null;
  }
}

function scheduleGameTimer(room: Room) {
  clearGameTimer(room);
  if (room.state.status !== 'playing') return;
  stampGameTiming(room);
  const deadline = room.state.gameDeadline;
  if (!deadline) return;
  const ms = Math.max(0, deadline - Date.now());
  room.gameTimer = setTimeout(() => {
    if (!rooms.has(room.id)) return;
    if (room.state.status !== 'playing') return;
    if (isGameTimeExpired(room.state)) {
      room.state = finishGameByTime(room.state);
      clearAllTimers(room);
      broadcastState(room);
      return;
    }
    scheduleGameTimer(room);
  }, ms + 20);
}

function scheduleTurnTimer(room: Room) {
  const key = turnKeyOf(room.state);
  if (!key) {
    clearTurnTimer(room);
    room.state.turnDeadline = null;
    room.state.turnDurationMs = FIXED_TURN_MS;
    return;
  }
  if (isGameTimeExpired(room.state)) {
    room.state = finishGameByTime(room.state);
    clearAllTimers(room);
    broadcastState(room);
    return;
  }
  if (room.turnTimer && room.turnKey === key) return;
  clearTurnTimer(room);
  room.turnKey = key;
  stampTurnTiming(room);
  const token = room.turnToken;
  room.turnTimer = setTimeout(() => {
    if (token !== room.turnToken) return;
    void autoPlayTurn(room, token);
  }, FIXED_TURN_MS);
}

function scheduleTimers(room: Room) {
  if (room.state.status !== 'playing') {
    clearAllTimers(room);
    return;
  }
  scheduleGameTimer(room);
  scheduleTurnTimer(room);
}

function broadcastState(room: Room, explosions?: { r: number; c: number; owner: number }[]) {
  broadcast(room, { type: 'state', state: room.state, explosions, players: publicPlayers(room) });
}

function autoPlayTurn(room: Room, token: number) {
  if (token !== room.turnToken) return;
  if (!rooms.has(room.id)) return;
  if (room.state.status !== 'playing') return;
  if (isGameTimeExpired(room.state)) {
    room.state = finishGameByTime(room.state);
    clearAllTimers(room);
    broadcastState(room);
    return;
  }
  const current = room.state.players[room.state.currentPlayerIndex];
  if (!current || !current.alive) {
    scheduleTimers(room);
    return;
  }
  const moves = getValidMoves(room.state, current.id);
  if (moves.length === 0) {
    room.state = removePlayerCells(room.state, current.id);
    room.state.turnDurationMs = FIXED_TURN_MS;
    broadcastState(room);
    if (room.state.status === 'playing') scheduleTimers(room);
    else { room.state.turnDeadline = null; room.state.gameDeadline = null; clearAllTimers(room); }
    return;
  }
  const move = moves[Math.floor(Math.random() * moves.length)];
  const result = applyMove(room.state, current.id, move.r, move.c);
  if (!result.ok || !result.state) {
    scheduleTimers(room);
    return;
  }
  room.state = result.state;
  room.state.turnDurationMs = FIXED_TURN_MS;
  broadcastState(room, result.explosions);
  if (room.state.status === 'playing') scheduleTimers(room);
  else { room.state.turnDeadline = null; clearAllTimers(room); }
}

function removeActivePlayer(room: Room, playerId: number, opts?: { closeSocket?: boolean }) {
  if (!rooms.has(room.id)) return;
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return;
  if (p.removed) return;
  p.removed = true;
  p.connected = false;
  p.quality = 'offline';

  if (room.state.status === 'waiting') {
    // remove from lobby and reindex
    const closing = p.ws;
    if (closing) {
      const sess = sessionByWs.get(closing);
      if (sess && sess.room === room && sess.playerId === playerId) {
        sess.playerId = null;
        sess.role = null;
      }
    }
    room.players = room.players.filter((x) => x.id !== playerId);
    room.players.forEach((pl, i) => {
      pl.id = i;
      pl.color = PLAYER_COLORS[i];
      pl.removed = false;
      if (pl.ws) {
        const sess = sessionByWs.get(pl.ws);
        if (sess && sess.room === room && sess.role === 'player') {
          sess.playerId = i;
        }
      }
    });
    room.hostId = room.players.length > 0 ? 0 : -1;
    if (room.players.length === 0) {
      clearAllTimers(room);
      room.state = lobbyState(room);
      // If no one is watching, clean up the room; otherwise keep it so a spectator can become a player.
      if (spectatorsCount(room) === 0) {
        for (const s of room.spectators) { try { s.ws?.close(); } catch {} }
        rooms.delete(room.id);
      } else {
        broadcastRoom(room);
        broadcastPresence(room);
      }
      if (opts?.closeSocket) try { closing?.close(); } catch {}
      return;
    }
    room.state = lobbyState(room);
    broadcastRoom(room);
    if (opts?.closeSocket) try { closing?.close(); } catch {}
    return;
  }

  if (room.state.status === 'playing') {
    room.state = removePlayerCells(room.state, playerId);
    broadcastState(room);
    if (room.state.status === 'playing') scheduleTimers(room);
    else clearAllTimers(room);
  } else {
    broadcastState(room);
  }

  if (opts?.closeSocket) try { p.ws?.close(); } catch {}
  p.ws = null;
}

function reindexLobbyAfterLeave(room: Room, leaverId: number) {
  // legacy path not used; removeActivePlayer handles lobby
  void leaverId;
}

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get('/', (c) => c.text('Color Wars server running'));

app.get(
  '/ws',
  upgradeWebSocket(() => {
    const sess: SessionState = { room: null, playerId: null, role: null, spectatorId: null };
    const rl = { windowStart: Date.now(), count: 0, penaltyUntil: 0 };

    const checkRate = (cost = 1, burst = 40, perMs = 10_000) => {
      const now = Date.now();
      if (now < rl.penaltyUntil) return false;
      if (now - rl.windowStart > perMs) { rl.windowStart = now; rl.count = 0; }
      rl.count += cost;
      if (rl.count > burst) {
        rl.penaltyUntil = now + 1500;
        return false;
      }
      return true;
    };

    const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
    const asName = (v: unknown) => (typeof v === 'string' ? v : '').trim().slice(0, 20) || 'Player';
    const asRoomId = (v: unknown) => (typeof v === 'string' ? v : '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const asInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : NaN);

    return {
      onMessage(event, ws) {
        sessionByWs.set(ws, sess);
        const raw = typeof event.data === 'string' ? event.data : (event.data instanceof ArrayBuffer ? Buffer.from(event.data).toString('utf8') : String(event.data ?? ''));
        if (raw.length > 4096) {
          send(ws, { type: 'error', message: 'Message too large' });
          try { ws.close(); } catch {}
          return;
        }
        if (!checkRate(1)) {
          send(ws, { type: 'error', message: 'Too many requests' });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          send(ws, { type: 'error', message: 'Invalid message' });
          return;
        }
        if (!isObj(parsed) || typeof parsed.type !== 'string') {
          send(ws, { type: 'error', message: 'Invalid message' });
          return;
        }
        const msg = parsed as ClientMsg;

        if (msg.type === 'create') {
          if (sess.room && (sess.playerId != null || sess.role === 'spectator')) return send(ws, { type: 'error', message: 'Already in a room' });
          if (!checkRate(5)) return send(ws, { type: 'error', message: 'Too many requests' });
          const name = asName((msg as any).name);
          const id = makeId();
          const maxPlayersRaw = asInt((msg as any).maxPlayers);
          const maxPlayers = Number.isFinite(maxPlayersRaw) ? Math.max(2, Math.min(8, maxPlayersRaw)) : 8;
          const gridIn = isObj((msg as any).grid) ? (msg as any).grid : null;
          const chosenGrid = gridIn ? normalizeGridChoice((gridIn as any).rows, (gridIn as any).cols) : null;
          const shape = normalizeBoardShape((msg as any).shape);
          const gameTimeMinutes = normalizeGameTimeMinutes((msg as any).gameTimeMinutes);
          const teamMode = normalizeTeamMode((msg as any).teamMode);
          const room: Room = {
            id,
            hostId: 0,
            players: [],
            spectators: [],
            state: null as any,
            turnTimer: null,
            gameTimer: null,
            turnToken: 0,
            turnKey: null,
            chosenGrid,
            maxPlayers,
            shape,
            gameTimeMinutes,
            teamMode: (teamMode === '2v2' && maxPlayers === 4) || (teamMode === '3v3' && maxPlayers === 6) ? teamMode : 'off',
          };
          const clientId = typeof (msg as any).clientId === 'string' ? String((msg as any).clientId).slice(0, 80) : undefined;
          const tabId = typeof (msg as any).tabId === 'string' ? String((msg as any).tabId).slice(0, 80) : undefined;
          const player: RoomPlayer = { id: 0, name, color: PLAYER_COLORS[0], clientId, tabId, ws, connected: true, quality: 'good', rtt: null, lastSeen: Date.now(), removed: false };
          room.players.push(player);
          room.state = lobbyState(room);
          rooms.set(id, room);
          sess.room = room;
          sess.playerId = 0;
          sess.role = 'player';
          sess.spectatorId = null;
          send(ws, roomPayload(room, 0, { role: 'player' }));
          return;
        }

        if (msg.type === 'join') {
          if (sess.room && (sess.playerId != null || sess.role === 'spectator')) return send(ws, { type: 'error', message: 'Already in a room' });
          if (!checkRate(4)) return send(ws, { type: 'error', message: 'Too many requests' });
          const name = asName((msg as any).name);
          const roomId = asRoomId((msg as any).roomId);
          if (!roomId) return send(ws, { type: 'error', message: 'Invalid room code' });
          const room = rooms.get(roomId);
          if (!room) return send(ws, { type: 'error', message: 'Room not found' });
          if (room.state.status !== 'waiting') return send(ws, { type: 'error', message: 'Game already started' });
          if (room.players.length >= room.maxPlayers) return send(ws, { type: 'error', message: `Room is full (max ${room.maxPlayers} players)` });
          const clientId = typeof (msg as any).clientId === 'string' ? String((msg as any).clientId).slice(0, 80) : undefined;
          if (clientId) {
            const existing = room.players.find(p => p.clientId && p.clientId === clientId);
            if (existing) {
              return send(ws, { type: 'error', message: existing.removed ? 'Player session expired' : 'Already joined this room. Reconnecting…' });
            }
          }
          const pid = room.players.length;
          const tabId = typeof (msg as any).tabId === 'string' ? String((msg as any).tabId).slice(0, 80) : undefined;
          const player: RoomPlayer = { id: pid, name, color: PLAYER_COLORS[pid], clientId, tabId, ws, connected: true, quality: 'good', rtt: null, lastSeen: Date.now(), removed: false };
          room.players.push(player);
          if (room.players.length === 1) room.hostId = 0;
          room.state = lobbyState(room);
          sess.room = room;
          sess.playerId = pid;
          sess.role = 'player';
          sess.spectatorId = null;
          broadcastRoom(room);
          return;
        }

        if (msg.type === 'spectate') {
          if (sess.room && (sess.role === 'player' || sess.role === 'spectator')) return send(ws, { type: 'error', message: 'Already in a room' });
          if (!checkRate(4)) return send(ws, { type: 'error', message: 'Too many requests' });
          const roomId = asRoomId((msg as any).roomId);
          if (!roomId) return send(ws, { type: 'error', message: 'Invalid room code' });
          const room = rooms.get(roomId);
          if (!room) return send(ws, { type: 'error', message: 'Room not found' });
          const name = asName((msg as any).name);
          const clientId = typeof (msg as any).clientId === 'string' ? String((msg as any).clientId).slice(0, 80) : undefined;
          const tabId = typeof (msg as any).tabId === 'string' ? String((msg as any).tabId).slice(0, 80) : undefined;
          // if same client is already a player, prefer rejoin flow
          if (clientId && room.players.some(p => p.clientId === clientId)) {
            return send(ws, { type: 'error', message: 'Already joined as player. Use rejoin.' });
          }
          if (clientId) {
            const existing = room.spectators.find(s => s.clientId && s.clientId === clientId);
            if (existing) {
              existing.ws = ws; existing.connected = true; existing.name = name; if (tabId) existing.tabId = tabId;
              sess.room = room; sess.role = 'spectator'; sess.spectatorId = existing.id; sess.playerId = null;
              send(ws, roomPayload(room, -1, { role: 'spectator', spectatorId: existing.id }));
              broadcastPresence(room);
              return;
            }
          }
          const sid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
          room.spectators.push({ id: sid, name, clientId, tabId, ws, connected: true });
          sess.room = room; sess.role = 'spectator'; sess.spectatorId = sid; sess.playerId = null;
          send(ws, roomPayload(room, -1, { role: 'spectator', spectatorId: sid }));
          broadcastPresence(room);
          return;
        }

        if (msg.type === 'rejoin') {
          if (!checkRate(4)) return send(ws, { type: 'error', message: 'Too many requests' });
          const roomId = asRoomId((msg as any).roomId);
          if (!roomId) return send(ws, { type: 'error', message: 'Invalid room code' });
          const room = rooms.get(roomId);
          if (!room) return send(ws, { type: 'error', message: 'Room not found' });
          const pid = asInt((msg as any).playerId);
          if (!Number.isInteger(pid) || pid < 0 || pid > 99) return send(ws, { type: 'error', message: 'Invalid player session' });
          const player = room.players.find((p) => p.id === pid);
          if (!player) return send(ws, { type: 'error', message: 'Player not found in room' });
          // Prevent hijacking another active socket by guessing sess.playerId from a different connection context
          if (sess.room && sess.room !== room) return send(ws, { type: 'error', message: 'Already in another room' });
          const clientId = typeof (msg as any).clientId === 'string' ? String((msg as any).clientId).slice(0, 80) : undefined;
          if (player.clientId && clientId && player.clientId !== clientId) {
            return send(ws, { type: 'error', message: 'Session mismatch' });
          }
          if (!player.clientId && clientId) player.clientId = clientId;
          const tabId = typeof (msg as any).tabId === 'string' ? String((msg as any).tabId).slice(0, 80) : undefined;
          // A second tab sharing the same identity must not silently steal the live socket.
          // Same-tab reloads keep their sessionStorage tabId, so they are allowed to take over.
          const liveElsewhere = !!player.ws && player.ws !== ws && player.connected && player.ws.readyState === 1 && Date.now() - player.lastSeen < 30_000;
          if (liveElsewhere && player.tabId && tabId && player.tabId !== tabId) {
            return send(ws, { type: 'error', message: 'Already connected in another tab' });
          }
          if (liveElsewhere && !player.tabId && Date.now() - player.lastSeen < 15_000) {
            return send(ws, { type: 'error', message: 'Already connected in another tab' });
          }
          if (player.ws && player.ws !== ws) {
            try { player.ws.close(4001, 'Session moved'); } catch {}
          }
          if (tabId) player.tabId = tabId;
          if (player.removed && room.state.status === 'playing') {
            // player left/cells vanished; allow sync but they remain out
          }
          player.ws = ws;
          player.connected = !player.removed || room.state.status !== 'playing' ? true : player.connected;
          // if they were removed during play, keep them as removed/offline in gameplay terms
          if (player.removed && room.state.status === 'playing') {
            player.connected = true; // socket connected for receiving updates/spectating
          }
          player.lastSeen = Date.now();
          if (!player.removed) player.quality = player.quality === 'offline' ? 'good' : player.quality;
          sess.room = room;
          sess.playerId = pid;
          if (room.state.status === 'playing') scheduleTimers(room);
          sess.role = 'player';
          sess.spectatorId = null;
          send(ws, roomPayload(room, pid, { role: 'player' }));
          broadcastPresence(room);
          return;
        }

        if (msg.type === 'ping') {
          if (sess.room && sess.playerId != null) {
            const p = sess.room.players.find(x => x.id === sess.playerId);
            if (p) p.lastSeen = Date.now();
          }
          const ts = typeof (msg as any).ts === 'number' && Number.isFinite((msg as any).ts) ? (msg as any).ts : undefined;
          return send(ws, { type: 'pong', ts });
        }

        if (msg.type === 'quality') {
          if (!sess.room || sess.playerId == null) return;
          if (!checkRate(2)) return;
          const p = sess.room.players.find(x => x.id === sess.playerId);
          if (!p) return;
          const q = (msg as any).quality;
          if (q === 'good' || q === 'ok' || q === 'bad') p.quality = q;
          const rtt = (msg as any).rtt;
          if (typeof rtt === 'number' && Number.isFinite(rtt)) p.rtt = Math.max(0, Math.min(10000, Math.round(rtt)));
          p.lastSeen = Date.now();
          broadcastPresence(sess.room);
          return;
        }

        if (!sess.room || (sess.role === 'player' && sess.playerId == null) || (sess.role === 'spectator' && sess.spectatorId == null)) {
          return send(ws, { type: 'error', message: 'Join or create a room first' });
        }
        const room = sess.room;
        if (sess.role === 'spectator') {
          if ((msg as any).type === 'leave') {
            room.spectators = room.spectators.filter(s => s.id !== sess.spectatorId);
            try { ws.close(); } catch {}
            sess.room = null; sess.role = null; sess.spectatorId = null; sess.playerId = null;
            broadcastPresence(room);
            return;
          }
          if ((msg as any).type === 'become_player') {
            if (!checkRate(4)) return send(ws, { type: 'error', message: 'Too many requests' });
            if (room.state.status !== 'waiting') return send(ws, { type: 'error', message: 'Game already started' });
            if (room.players.length >= room.maxPlayers) return send(ws, { type: 'error', message: `Room is full (max ${room.maxPlayers} players)` });
            const spec = room.spectators.find(s => s.id === sess.spectatorId);
            if (!spec || spec.ws !== ws) return send(ws, { type: 'error', message: 'Invalid spectator session' });
            const name = asName((msg as any).name || spec.name);
            const clientId = spec.clientId;
            const tabId = spec.tabId;
            if (clientId && room.players.some(p => p.clientId === clientId)) {
              return send(ws, { type: 'error', message: 'Already joined as player. Use rejoin.' });
            }
            // remove spectator record
            room.spectators = room.spectators.filter(s => s.id !== sess.spectatorId);
            const pid = room.players.length;
            const player: RoomPlayer = { id: pid, name, color: PLAYER_COLORS[pid], clientId, tabId, ws, connected: true, quality: 'good', rtt: null, lastSeen: Date.now(), removed: false };
            room.players.push(player);
            if (room.players.length === 1) room.hostId = 0;
            room.state = lobbyState(room);
            sess.role = 'player';
            sess.playerId = pid;
            sess.spectatorId = null;
            broadcastRoom(room);
            return;
          }
          return send(ws, { type: 'error', message: 'Spectators cannot perform this action' });
        }
        if (sess.playerId == null) return send(ws, { type: 'error', message: 'Invalid session' });
        const me = room.players.find(p => p.id === sess.playerId);
        if (me) me.lastSeen = Date.now();

        if (msg.type === 'leave') {
          if (!checkRate(2)) return;
          removeActivePlayer(room, sess.playerId, { closeSocket: false });
          try { ws.close(); } catch {}
          return;
        }

        if (msg.type === 'start') {
          if (!checkRate(3)) return send(ws, { type: 'error', message: 'Too many requests' });
          if (sess.playerId !== room.hostId) return send(ws, { type: 'error', message: 'Only host can start' });
          if (room.state.status !== 'waiting') return send(ws, { type: 'error', message: 'Game already started' });
          if (room.players.length < 2) return send(ws, { type: 'error', message: 'Need at least 2 players' });
          if (room.teamMode !== 'off' && !isValidTeamModeForPlayers(room.teamMode, room.players.length)) {
            return send(ws, { type: 'error', message: `Team mode ${room.teamMode} requires ${room.teamMode === '2v2' ? 4 : 6} players` });
          }
          room.state = createGame(room.players.map((p) => ({ name: p.name })), room.state.rows, room.state.cols, {
            shape: room.shape,
            gameTimeMinutes: room.gameTimeMinutes,
            maxPlayers: room.maxPlayers,
            teamMode: room.teamMode,
          });
          for (const p of room.players) { p.removed = false; if (p.connected) p.quality = p.quality === 'offline' ? 'good' : p.quality; }
          stampGameTiming(room);
          stampTurnTiming(room);
          broadcastState(room);
          scheduleTimers(room);
          return;
        }

        if (msg.type === 'move') {
          if (!checkRate(2)) return send(ws, { type: 'error', message: 'Too many requests' });
          const playerRec = room.players.find(p => p.id === sess.playerId);
          if (!playerRec || playerRec.ws !== ws) return send(ws, { type: 'error', message: 'Invalid session' });
          if (playerRec.removed) return send(ws, { type: 'error', message: 'You left the game' });
          if (isGameTimeExpired(room.state)) {
            room.state = finishGameByTime(room.state);
            clearAllTimers(room);
            broadcastState(room);
            return;
          }
          const r = asInt((msg as any).r);
          const c = asInt((msg as any).c);
          if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r > 100 || c > 100) {
            return send(ws, { type: 'error', message: 'Invalid move' });
          }
          const result = applyMove(room.state, sess.playerId, r, c);
          if (!result.ok || !result.state) return send(ws, { type: 'error', message: result.error || 'Invalid move' });
          room.state = result.state;
          room.state.turnDurationMs = FIXED_TURN_MS;
          broadcastState(room, result.explosions);
          if (room.state.status === 'playing') scheduleTimers(room);
          else { room.state.turnDeadline = null; clearAllTimers(room); }
          return;
        }

        if (msg.type === 'rematch') {
          if (!checkRate(3)) return send(ws, { type: 'error', message: 'Too many requests' });
          if (sess.playerId !== room.hostId) return send(ws, { type: 'error', message: 'Only host can start rematch' });
          if (room.state.status === 'playing') return send(ws, { type: 'error', message: 'Game still in progress' });
          if (room.players.length < 2) return send(ws, { type: 'error', message: 'Need at least 2 players' });
          clearAllTimers(room);
          for (const p of room.players) { p.removed = false; if (p.connected) p.quality = p.quality === 'offline' ? 'good' : p.quality; }
          room.state = lobbyState(room);
          broadcastRoom(room);
          return;
        }
      },
      onClose(_evt, ws) {
        if (!sess.room) return;
        const room = sess.room;
        if (sess.role === 'spectator') {
          if (sess.spectatorId) {
            // remove spectator on disconnect (they can re-spectate; keeps list clean)
            room.spectators = room.spectators.filter(s => !(s.id === sess.spectatorId && s.ws === ws));
            broadcastPresence(room);
          }
          return;
        }
        if (sess.playerId == null) return;
        const p = room.players.find((x) => x.id === sess.playerId);
        // ignore stale socket closes after a successful rejoin
        if (p && p.ws !== ws) return;
        if (!p) return;

        if (room.state.status === 'waiting') {
          // lobby: free the slot so others can join/start; disconnected lobby players don't have game progress
          removeActivePlayer(room, sess.playerId, { closeSocket: false });
          return;
        }

        if (room.state.status === 'playing') {
          // Any player gone (disconnect/tab close) should have their cells removed.
          removeActivePlayer(room, sess.playerId, { closeSocket: false });
          return;
        }

        p.connected = false;
        p.quality = 'offline';
        p.ws = null;
        broadcastPresence(room);
      },
    };
  })
);

const port = Number(process.env.PORT || 3001);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
