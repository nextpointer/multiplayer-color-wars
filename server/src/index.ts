import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import type { WSContext } from 'hono/ws';
import {
  applyMove,
  createEmptyBoard,
  createGame,
  getValidMoves,
  normalizeGridChoice,
  recommendedBoardSize,
  removePlayerCells,
  type GameState,
  type GridSize,
  PLAYER_COLORS,
} from '@game/shared';

type ConnQuality = 'good' | 'ok' | 'bad' | 'offline';

type ClientMsg =
  | { type: 'create'; name: string; maxPlayers?: number; grid?: { rows: number; cols: number } | null }
  | { type: 'join'; roomId: string; name: string }
  | { type: 'rejoin'; roomId: string; playerId: number; name?: string }
  | { type: 'start' }
  | { type: 'move'; r: number; c: number }
  | { type: 'rematch' }
  | { type: 'leave' }
  | { type: 'ping'; ts?: number }
  | { type: 'quality'; quality: ConnQuality; rtt?: number };

type PublicPlayer = { id: number; name: string; color: string; connected: boolean; quality: ConnQuality };

type ServerMsg =
  | { type: 'room'; roomId: string; playerId: number; players: PublicPlayer[]; hostId: number; state: GameState }
  | { type: 'state'; state: GameState; explosions?: { r: number; c: number; owner: number }[]; players?: PublicPlayer[] }
  | { type: 'presence'; players: PublicPlayer[] }
  | { type: 'error'; message: string }
  | { type: 'pong'; ts?: number };

interface RoomPlayer {
  id: number;
  name: string;
  color: string;
  ws: WSContext | null;
  connected: boolean;
  quality: ConnQuality;
  rtt: number | null;
  lastSeen: number;
  removed: boolean; // left/removed from active play
}

interface Room {
  id: string;
  hostId: number;
  players: RoomPlayer[];
  state: GameState;
  turnTimer?: ReturnType<typeof setTimeout> | null;
  turnToken: number;
  turnKey: string | null;
  chosenGrid: GridSize | null;
  maxPlayers: number;
}

const rooms = new Map<string, Room>();
const TURN_MS = 60_000;

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

function broadcast(room: Room, msg: ServerMsg) {
  for (const p of room.players) {
    if (p.connected && p.ws) send(p.ws, msg);
  }
}

function broadcastPresence(room: Room) {
  broadcast(room, { type: 'presence', players: publicPlayers(room) });
}

function roomPayload(room: Room, playerId: number): ServerMsg {
  return {
    type: 'room',
    roomId: room.id,
    playerId,
    players: publicPlayers(room),
    hostId: room.hostId,
    state: room.state,
  };
}

function broadcastRoom(room: Room) {
  for (const p of room.players) {
    if (p.connected && p.ws) send(p.ws, roomPayload(room, p.id));
  }
}

function lobbyState(room: Room): GameState {
  const size = room.chosenGrid || recommendedBoardSize(Math.max(room.players.length, 2));
  return {
    rows: size.rows,
    cols: size.cols,
    board: createEmptyBoard(size.rows, size.cols),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      alive: true,
      hasPlayed: false,
    })),
    currentPlayerIndex: 0,
    status: 'waiting',
    winner: null,
    turnCount: 0,
    maxPlayers: room.maxPlayers,
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

function clearAllTimers(room: Room) {
  clearTurnTimer(room);
}

function scheduleTurnTimer(room: Room) {
  const key = turnKeyOf(room.state);
  if (!key) {
    clearTurnTimer(room);
    return;
  }
  if (room.turnTimer && room.turnKey === key) return;
  clearTurnTimer(room);
  room.turnKey = key;
  const token = room.turnToken;
  room.turnTimer = setTimeout(() => {
    if (token !== room.turnToken) return;
    void autoPlayTurn(room, token);
  }, TURN_MS);
}

function broadcastState(room: Room, explosions?: { r: number; c: number; owner: number }[]) {
  broadcast(room, { type: 'state', state: room.state, explosions, players: publicPlayers(room) });
}

function autoPlayTurn(room: Room, token: number) {
  if (token !== room.turnToken) return;
  if (!rooms.has(room.id)) return;
  if (room.state.status !== 'playing') return;
  const current = room.state.players[room.state.currentPlayerIndex];
  if (!current || !current.alive) {
    scheduleTurnTimer(room);
    return;
  }
  const moves = getValidMoves(room.state, current.id);
  if (moves.length === 0) {
    room.state = removePlayerCells(room.state, current.id);
    broadcastState(room);
    if (room.state.status === 'playing') scheduleTurnTimer(room);
    else clearTurnTimer(room);
    return;
  }
  const move = moves[Math.floor(Math.random() * moves.length)];
  const result = applyMove(room.state, current.id, move.r, move.c);
  if (!result.ok || !result.state) {
    scheduleTurnTimer(room);
    return;
  }
  room.state = result.state;
  broadcastState(room, result.explosions);
  if (room.state.status === 'playing') scheduleTurnTimer(room);
  else clearTurnTimer(room);
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
    room.players = room.players.filter((x) => x.id !== playerId);
    room.players.forEach((pl, i) => { pl.id = i; pl.color = PLAYER_COLORS[i]; pl.removed = false; });
    room.hostId = 0;
    if (room.players.length === 0) {
      clearAllTimers(room);
      rooms.delete(room.id);
      if (opts?.closeSocket) try { closing?.close(); } catch {}
      return;
    }
    room.state = lobbyState(room);
    for (const pl of room.players) {
      if (pl.ws) send(pl.ws, roomPayload(room, pl.id));
    }
    if (opts?.closeSocket) try { closing?.close(); } catch {}
    return;
  }

  if (room.state.status === 'playing') {
    room.state = removePlayerCells(room.state, playerId);
    broadcastState(room);
    if (room.state.status === 'playing') scheduleTurnTimer(room);
    else clearTurnTimer(room);
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
    let currentRoom: Room | null = null;
    let playerId: number | null = null;

    return {
      onMessage(event, ws) {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          send(ws, { type: 'error', message: 'Invalid message' });
          return;
        }

        if (msg.type === 'create') {
          const name = (msg.name || 'Player').trim().slice(0, 20) || 'Player';
          const id = makeId();
          const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(msg.maxPlayers) || 8)));
          const chosenGrid = msg.grid ? normalizeGridChoice((msg.grid as any).rows, (msg.grid as any).cols) : null;
          const room: Room = {
            id,
            hostId: 0,
            players: [],
            state: null as any,
            turnTimer: null,
            turnToken: 0,
            turnKey: null,
            chosenGrid,
            maxPlayers,
          };
          const player: RoomPlayer = { id: 0, name, color: PLAYER_COLORS[0], ws, connected: true, quality: 'good', rtt: null, lastSeen: Date.now(), removed: false };
          room.players.push(player);
          room.state = lobbyState(room);
          rooms.set(id, room);
          currentRoom = room;
          playerId = 0;
          send(ws, roomPayload(room, 0));
          return;
        }

        if (msg.type === 'join') {
          const name = (msg.name || 'Player').trim().slice(0, 20) || 'Player';
          const roomId = (msg.roomId || '').toUpperCase().trim();
          const room = rooms.get(roomId);
          if (!room) return send(ws, { type: 'error', message: 'Room not found' });
          if (room.state.status !== 'waiting') return send(ws, { type: 'error', message: 'Game already started' });
          if (room.players.length >= room.maxPlayers) return send(ws, { type: 'error', message: `Room is full (max ${room.maxPlayers} players)` });
          const pid = room.players.length;
          const player: RoomPlayer = { id: pid, name, color: PLAYER_COLORS[pid], ws, connected: true, quality: 'good', rtt: null, lastSeen: Date.now(), removed: false };
          room.players.push(player);
          room.state = lobbyState(room);
          currentRoom = room;
          playerId = pid;
          broadcastRoom(room);
          return;
        }

        if (msg.type === 'rejoin') {
          const roomId = (msg.roomId || '').toUpperCase().trim();
          const room = rooms.get(roomId);
          if (!room) return send(ws, { type: 'error', message: 'Room not found' });
          const pid = Number(msg.playerId);
          const player = room.players.find((p) => p.id === pid);
          if (!player) return send(ws, { type: 'error', message: 'Player not found in room' });
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
          currentRoom = room;
          playerId = pid;
          if (room.state.status === 'playing') scheduleTurnTimer(room);
          send(ws, roomPayload(room, pid));
          broadcastPresence(room);
          return;
        }

        if (msg.type === 'ping') {
          if (currentRoom && playerId != null) {
            const p = currentRoom.players.find(x => x.id === playerId);
            if (p) p.lastSeen = Date.now();
          }
          return send(ws, { type: 'pong', ts: msg.ts });
        }

        if (msg.type === 'quality') {
          if (!currentRoom || playerId == null) return;
          const p = currentRoom.players.find(x => x.id === playerId);
          if (!p) return;
          if (msg.quality === 'good' || msg.quality === 'ok' || msg.quality === 'bad') p.quality = msg.quality;
          if (typeof msg.rtt === 'number') p.rtt = msg.rtt;
          p.lastSeen = Date.now();
          broadcastPresence(currentRoom);
          return;
        }

        if (!currentRoom || playerId == null) {
          return send(ws, { type: 'error', message: 'Join or create a room first' });
        }
        const room = currentRoom;
        const me = room.players.find(p => p.id === playerId);
        if (me) me.lastSeen = Date.now();

        if (msg.type === 'leave') {
          removeActivePlayer(room, playerId, { closeSocket: false });
          try { ws.close(); } catch {}
          return;
        }

        if (msg.type === 'start') {
          if (playerId !== room.hostId) return send(ws, { type: 'error', message: 'Only host can start' });
          if (room.players.length < 2) return send(ws, { type: 'error', message: 'Need at least 2 players' });
          room.state = createGame(room.players.map((p) => ({ name: p.name })), room.state.rows, room.state.cols);
          room.state.maxPlayers = room.maxPlayers;
          for (const p of room.players) { p.removed = false; if (p.connected) p.quality = p.quality === 'offline' ? 'good' : p.quality; }
          broadcastState(room);
          scheduleTurnTimer(room);
          return;
        }

        if (msg.type === 'move') {
          const playerRec = room.players.find(p => p.id === playerId);
          if (playerRec?.removed) return send(ws, { type: 'error', message: 'You left the game' });
          const result = applyMove(room.state, playerId, msg.r, msg.c);
          if (!result.ok || !result.state) return send(ws, { type: 'error', message: result.error || 'Invalid move' });
          room.state = result.state;
          broadcastState(room, result.explosions);
          if (room.state.status === 'playing') scheduleTurnTimer(room);
          else clearTurnTimer(room);
          return;
        }

        if (msg.type === 'rematch') {
          if (playerId !== room.hostId) return send(ws, { type: 'error', message: 'Only host can start rematch' });
          if (room.players.length < 2) return send(ws, { type: 'error', message: 'Need at least 2 players' });
          clearTurnTimer(room);
          for (const p of room.players) { p.removed = false; if (p.connected) p.quality = p.quality === 'offline' ? 'good' : p.quality; }
          room.state = lobbyState(room);
          broadcastRoom(room);
          return;
        }
      },
      onClose(_evt, ws) {
        if (!currentRoom || playerId == null) return;
        const room = currentRoom;
        const p = room.players.find((x) => x.id === playerId);
        // ignore stale socket closes after a successful rejoin
        if (p && p.ws !== ws) return;
        if (!p) return;

        if (room.state.status === 'waiting') {
          removeActivePlayer(room, playerId, { closeSocket: false });
          return;
        }

        if (room.state.status === 'playing') {
          // player left/disconnected: vanish their cells immediately
          p.ws = null;
          removeActivePlayer(room, playerId, { closeSocket: false });
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
