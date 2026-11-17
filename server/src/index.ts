import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import type { WSContext } from 'hono/ws';
import {
  applyMove,
  createEmptyBoard,
  createGame,
  recommendedBoardSize,
  type GameState,
  PLAYER_COLORS,
} from '@game/shared';

type ClientMsg =
  | { type: 'create'; name: string }
  | { type: 'join'; roomId: string; name: string }
  | { type: 'start' }
  | { type: 'move'; r: number; c: number }
  | { type: 'rematch' };

type ServerMsg =
  | { type: 'room'; roomId: string; playerId: number; players: { id: number; name: string; color: string }[]; hostId: number; state: GameState }
  | { type: 'state'; state: GameState; explosions?: { r: number; c: number; owner: number }[] }
  | { type: 'error'; message: string };

interface RoomPlayer {
  id: number;
  name: string;
  color: string;
  ws: WSContext;
  connected: boolean;
}

interface Room {
  id: string;
  hostId: number;
  players: RoomPlayer[];
  state: GameState;
  turnStartedAt?: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}

const rooms = new Map<string, Room>();

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

function nextAliveIndex(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    if (state.players[idx].alive) return idx;
  }
  return fromIndex;
}

function clearTurnTimer(room: Room) {
  if (room.timeoutId) {
    clearTimeout(room.timeoutId);
    room.timeoutId = undefined;
  }
}

function scheduleTurnTimer(room: Room) {
  clearTurnTimer(room);
  if (room.state.status !== 'playing') return;
  room.turnStartedAt = Date.now();
  room.timeoutId = setTimeout(() => {
    if (room.state.status !== 'playing') return;
    const from = room.state.currentPlayerIndex;
    const next = nextAliveIndex(room.state, from);
    room.state = { ...room.state, currentPlayerIndex: next, turnCount: room.state.turnCount + 1 };
    broadcast(room, { type: 'state', state: room.state });
    scheduleTurnTimer(room);
  }, 15000);
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
          };
          const player: RoomPlayer = { id: 0, name, color: PLAYER_COLORS[0], ws, connected: true };
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
          const player: RoomPlayer = { id: pid, name, color: PLAYER_COLORS[pid], ws, connected: true };
          room.players.push(player);
          room.state = lobbyState(room);
          currentRoom = room;
          playerId = pid;
          for (const p of room.players) send(p.ws, roomPayload(room, p.id));
          return;
        }

        if (!currentRoom || playerId == null) {
          return send(ws, { type: 'error', message: 'Join or create a room first' });
        }
        const room = currentRoom;

        if (msg.type === 'start') {
          if (playerId !== room.hostId) return send(ws, { type: 'error', message: 'Only host can start' });
          if (room.players.length < 2) return send(ws, { type: 'error', message: 'Need at least 2 players' });
          room.state = createGame(room.players.map((p) => ({ name: p.name })));
          broadcast(room, { type: 'state', state: room.state });
          scheduleTurnTimer(room);
          return;
        }

        if (msg.type === 'move') {
          const result = applyMove(room.state, playerId, msg.r, msg.c);
          if (!result.ok || !result.state) return send(ws, { type: 'error', message: result.error || 'Invalid move' });
          room.state = result.state;
          broadcast(room, { type: 'state', state: room.state, explosions: result.explosions });
          scheduleTurnTimer(room);
          return;
        }

        if (msg.type === 'rematch') {
          if (playerId !== room.hostId) return send(ws, { type: 'error', message: 'Only host can start rematch' });
          if (room.players.length < 2) return send(ws, { type: 'error', message: 'Need at least 2 players' });
          room.state = createGame(room.players.map((p) => ({ name: p.name })));
          broadcast(room, { type: 'state', state: room.state });
          scheduleTurnTimer(room);
          return;
        }
      },
      onClose(_evt, ws) {
        if (!currentRoom || playerId == null) return;
        const room = currentRoom;
        const p = room.players.find((x) => x.id === playerId);
        if (p) p.connected = false;
        // if in lobby, remove player
        if (room.state.status === 'waiting') {
          clearTurnTimer(room);
          room.players = room.players.filter((x) => x.id !== playerId);
          room.players.forEach((pl, i) => {
            pl.id = i;
            pl.color = PLAYER_COLORS[i];
          });
          room.hostId = 0;
          if (room.players.length === 0) {
            rooms.delete(room.id);
            return;
          }
          room.state = lobbyState(room);
          for (const pl of room.players) send(pl.ws, roomPayload(room, pl.id));
        } else if (room.state.status === 'playing') {
          // remove leaver's pieces and mark not alive
          const leaverId = playerId;
          const board = room.state.board.map(row => row.map(cell => cell.owner === leaverId ? { owner: null, count: 0 } : { ...cell }));
          const players = room.state.players.map(pl => pl.id === leaverId ? { ...pl, alive: false } : { ...pl });
          const alivePlayers = players.filter(pl => pl.alive);
          let nextState: GameState = { ...room.state, board, players };
          const connectedAlive = alivePlayers.filter(pl => room.players.find(rp => rp.id === pl.id)?.connected);
          if (room.state.players.length <= 2 || alivePlayers.length <= 1 || connectedAlive.length <= 1) {
            // end game
            const winner = alivePlayers.find(pl => room.players.find(rp => rp.id === pl.id)?.connected)?.id ?? (alivePlayers[0]?.id ?? null);
            nextState = { ...nextState, status: 'finished', winner };
            clearTurnTimer(room);
          } else {
            // if it was leaver's turn, advance
            if (room.state.players[room.state.currentPlayerIndex]?.id === leaverId) {
              nextState.currentPlayerIndex = nextAliveIndex(nextState, room.state.currentPlayerIndex);
            }
            // if current index now points to dead, fix
            if (!nextState.players[nextState.currentPlayerIndex]?.alive) {
              nextState.currentPlayerIndex = nextAliveIndex(nextState, nextState.currentPlayerIndex);
            }
          }
          room.state = nextState;
          broadcast(room, { type: 'state', state: room.state });
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
