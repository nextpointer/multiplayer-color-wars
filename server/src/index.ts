import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import type { WSContext } from 'hono/ws';
import {
  applyMove,
  createEmptyBoard,
  createGame,
  getValidMoves,
  recommendedBoardSize,
  removePlayerCells,
  type GameState,
  PLAYER_COLORS,
} from '@game/shared';

type ClientMsg =
  | { type: 'create'; name: string }
  | { type: 'join'; roomId: string; name: string }
  | { type: 'rejoin'; roomId: string; playerId: number; name?: string }
  | { type: 'start' }
  | { type: 'move'; r: number; c: number }
  | { type: 'rematch' }
  | { type: 'ping' };

type ServerMsg =
  | { type: 'room'; roomId: string; playerId: number; players: { id: number; name: string; color: string }[]; hostId: number; state: GameState }
  | { type: 'state'; state: GameState; explosions?: { r: number; c: number; owner: number }[] }
  | { type: 'error'; message: string }
  | { type: 'pong' };

interface RoomPlayer {
  id: number;
  name: string;
  color: string;
  ws: WSContext;
  connected: boolean;
  disconnectTimer?: ReturnType<typeof setTimeout> | null;
}

interface Room {
  id: string;
  hostId: number;
  players: RoomPlayer[];
  state: GameState;
  turnTimer?: ReturnType<typeof setTimeout> | null;
  turnToken: number;
  turnKey: string | null;
}

const rooms = new Map<string, Room>();
const TURN_MS = 60_000;
const GONE_MS = 60_000;

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

function send(ws: WSContext, msg: ServerMsg) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {}
}

function broadcast(room: Room, msg: ServerMsg) {
  for (const p of room.players) {
    if (p.connected) send(p.ws, msg);
  }
}

function publicPlayers(room: Room) {
  return room.players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
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

function lobbyState(room: Room): GameState {
  const size = recommendedBoardSize(Math.max(room.players.length, 2));
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
    maxPlayers: 8,
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

function clearGoneTimer(p: RoomPlayer) {
  if (p.disconnectTimer) {
    clearTimeout(p.disconnectTimer);
    p.disconnectTimer = null;
  }
}

function clearAllTimers(room: Room) {
  clearTurnTimer(room);
  for (const p of room.players) clearGoneTimer(p);
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
  broadcast(room, { type: 'state', state: room.state, explosions });
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
    // should be rare; avoid stalling by removing player's cells as a fallback
    room.state = removePlayerCells(room.state, current.id);
    broadcastState(room);
    if (room.state.status === 'playing') scheduleTurnTimer(room);
    else clearTurnTimer(room);
    return;
  }
  const move = moves[Math.floor(Math.random() * moves.length)];
  const result = applyMove(room.state, current.id, move.r, move.c);
  if (!result.ok || !result.state) {
    // fallback: try not to stall
    scheduleTurnTimer(room);
    return;
  }
  room.state = result.state;
  broadcastState(room, result.explosions);
  if (room.state.status === 'playing') scheduleTurnTimer(room);
  else clearTurnTimer(room);
}

function removeGonePlayer(room: Room, playerId: number) {
  if (!rooms.has(room.id)) return;
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return;
  clearGoneTimer(p);
  // if they reconnected somehow, don't remove
  if (p.connected) return;
  if (room.state.status !== 'playing') return;

  const beforeIndex = room.state.currentPlayerIndex;
  room.state = removePlayerCells(room.state, playerId);
  broadcastState(room);
  if (room.state.status !== 'playing') {
    clearTurnTimer(room);
    return;
  }
  // turn may have changed (if it was their turn or they were current), reschedule safely
  scheduleTurnTimer(room);
  // ensure we didn't leave a stale timer token state issue
  void beforeIndex;
}

function scheduleGoneTimer(room: Room, playerId: number) {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return;
  clearGoneTimer(p);
  p.disconnectTimer = setTimeout(() => {
    p.disconnectTimer = null;
    removeGonePlayer(room, playerId);
  }, GONE_MS);
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
          const room: Room = {
            id,
            hostId: 0,
            players: [],
            state: null as any,
            turnTimer: null,
            turnToken: 0,
            turnKey: null,
          };
          const player: RoomPlayer = { id: 0, name, color: PLAYER_COLORS[0], ws, connected: true, disconnectTimer: null };
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
          if (room.players.length >= 8) return send(ws, { type: 'error', message: 'Room is full (max 8 players)' });
          const pid = room.players.length;
          const player: RoomPlayer = { id: pid, name, color: PLAYER_COLORS[pid], ws, connected: true, disconnectTimer: null };
          room.players.push(player);
          room.state = lobbyState(room);
          currentRoom = room;
          playerId = pid;
          for (const p of room.players) send(p.ws, roomPayload(room, p.id));
          return;
        }

        if (msg.type === 'rejoin') {
          const roomId = (msg.roomId || '').toUpperCase().trim();
          const room = rooms.get(roomId);
          if (!room) return send(ws, { type: 'error', message: 'Room not found' });
          const pid = Number(msg.playerId);
          const player = room.players.find((p) => p.id === pid);
          if (!player) return send(ws, { type: 'error', message: 'Player not found in room' });
          player.ws = ws;
          player.connected = true;
          clearGoneTimer(player);
          currentRoom = room;
          playerId = pid;
          // if game is playing, ensure turn timer is running for current turn
          if (room.state.status === 'playing') scheduleTurnTimer(room);
          send(ws, roomPayload(room, pid));
          return;
        }

        if (msg.type === 'ping') {
          return send(ws, { type: 'pong' });
        }

        if (!currentRoom || playerId == null) {
          return send(ws, { type: 'error', message: 'Join or create a room first' });
        }
        const room = currentRoom;

        if (msg.type === 'start') {
          if (playerId !== room.hostId) return send(ws, { type: 'error', message: 'Only host can start' });
          if (room.players.length < 2) return send(ws, { type: 'error', message: 'Need at least 2 players' });
          room.state = createGame(room.players.map((p) => ({ name: p.name })));
          for (const p of room.players) clearGoneTimer(p);
          broadcast(room, { type: 'state', state: room.state });
          scheduleTurnTimer(room);
          return;
        }

        if (msg.type === 'move') {
          const result = applyMove(room.state, playerId, msg.r, msg.c);
          if (!result.ok || !result.state) return send(ws, { type: 'error', message: result.error || 'Invalid move' });
          room.state = result.state;
          broadcast(room, { type: 'state', state: room.state, explosions: result.explosions });
          if (room.state.status === 'playing') scheduleTurnTimer(room);
          else clearTurnTimer(room);
          return;
        }

        if (msg.type === 'rematch') {
          if (playerId !== room.hostId) return send(ws, { type: 'error', message: 'Only host can start rematch' });
          if (room.players.length < 2) return send(ws, { type: 'error', message: 'Need at least 2 players' });
          room.state = createGame(room.players.map((p) => ({ name: p.name })));
          for (const p of room.players) clearGoneTimer(p);
          broadcast(room, { type: 'state', state: room.state });
          scheduleTurnTimer(room);
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
        p.connected = false;
        // if in lobby, remove player
        if (room.state.status === 'waiting') {
          clearGoneTimer(p);
          room.players = room.players.filter((x) => x.id !== playerId);
          room.players.forEach((pl, i) => {
            pl.id = i;
            pl.color = PLAYER_COLORS[i];
          });
          room.hostId = 0;
          if (room.players.length === 0) {
            clearAllTimers(room);
            rooms.delete(room.id);
            return;
          }
          room.state = lobbyState(room);
          for (const pl of room.players) send(pl.ws, roomPayload(room, pl.id));
        } else if (room.state.status === 'playing') {
          // transient disconnect during play: keep player in game so they can rejoin,
          // but if they stay gone, remove their cells after grace period.
          scheduleGoneTimer(room, playerId);
          broadcast(room, { type: 'state', state: room.state });
          // ensure turn timer is running for the current turn (without resetting it)
          scheduleTurnTimer(room);
        } else {
          broadcast(room, { type: 'state', state: room.state });
        }
      },
    };
  })
);

const port = Number(process.env.PORT || 3001);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
