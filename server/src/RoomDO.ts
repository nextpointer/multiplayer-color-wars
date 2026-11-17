import {
  applyMove,
  createEmptyBoard,
  createGame,
  recommendedBoardSize,
  type GameState,
  PLAYER_COLORS,
} from '../../shared/src/index';

type ClientMsg =
  | { type: 'create'; name: string; roomId?: string }
  | { type: 'join'; roomId: string; name: string }
  | { type: 'start' }
  | { type: 'move'; r: number; c: number }
  | { type: 'rematch' };

type ServerMsg =
  | { type: 'room'; roomId: string; playerId: number; players: { id: number; name: string; color: string }[]; hostId: number; state: GameState }
  | { type: 'state'; state: GameState; explosions?: { r: number; c: number; owner: number }[] }
  | { type: 'error'; message: string };

interface Session {
  ws: WebSocket;
  playerId: number | null;
}

interface StoredPlayer {
  id: number;
  name: string;
  color: string;
  connected: boolean;
}

interface StoredRoom {
  id: string;
  hostId: number;
  players: StoredPlayer[];
  state: GameState;
  turnStartedAt?: number;
}

function publicPlayers(room: StoredRoom) {
  return room.players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
}

function lobbyState(room: StoredRoom): GameState {
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

function nextAliveIndex(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    if (state.players[idx].alive) return idx;
  }
  return fromIndex;
}

export class RoomDO {
  state: DurableObjectState;
  sessions: Set<Session> = new Set();
  room: StoredRoom | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      this.room = (await this.state.storage.get<StoredRoom>('room')) || null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/websocket') return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const session: Session = { ws: server, playerId: null };
    this.sessions.add(session);

    server.addEventListener('message', (ev) => {
      void this.onMessage(session, ev.data);
    });
    server.addEventListener('close', () => {
      void this.onClose(session);
    });
    server.addEventListener('error', () => {
      void this.onClose(session);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async persist() {
    if (this.room) await this.state.storage.put('room', this.room);
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  private broadcast(msg: ServerMsg) {
    for (const s of this.sessions) {
      if (s.playerId != null) this.send(s.ws, msg);
    }
  }

  private roomPayload(playerId: number): ServerMsg {
    const room = this.room!;
    return {
      type: 'room',
      roomId: room.id,
      playerId,
      players: publicPlayers(room),
      hostId: room.hostId,
      state: room.state,
    };
  }

  private async scheduleTurnTimer() {
    await this.state.storage.deleteAlarm();
    if (!this.room || this.room.state.status !== 'playing') return;
    this.room.turnStartedAt = Date.now();
    await this.persist();
    await this.state.storage.setAlarm(Date.now() + 15000);
  }

  async alarm() {
    if (!this.room || this.room.state.status !== 'playing') return;
    const from = this.room.state.currentPlayerIndex;
    const next = nextAliveIndex(this.room.state, from);
    this.room.state = { ...this.room.state, currentPlayerIndex: next, turnCount: this.room.state.turnCount + 1 };
    await this.persist();
    this.broadcast({ type: 'state', state: this.room.state });
    await this.scheduleTurnTimer();
  }

  private async handleCreate(session: Session, roomId: string, name: string) {
    if (!this.room) {
      this.room = {
        id: roomId,
        hostId: 0,
        players: [{ id: 0, name, color: PLAYER_COLORS[0], connected: true }],
        state: null as any,
      };
      this.room.state = lobbyState(this.room);
      session.playerId = 0;
      await this.persist();
      this.send(session.ws, this.roomPayload(0));
      return;
    }
    // room exists - if waiting and no one connected maybe allow? but create should be for new room
    this.send(session.ws, { type: 'error', message: 'Room already exists' });
  }

  private async handleJoin(session: Session, roomId: string, name: string) {
    if (!this.room) {
      this.send(session.ws, { type: 'error', message: 'Room not found' });
      return;
    }
    if (this.room.state.status !== 'waiting') {
      this.send(session.ws, { type: 'error', message: 'Game already started' });
      return;
    }
    if (this.room.players.length >= 8) {
      this.send(session.ws, { type: 'error', message: 'Room is full (max 8 players)' });
      return;
    }
    const pid = this.room.players.length;
    this.room.players.push({ id: pid, name, color: PLAYER_COLORS[pid], connected: true });
    this.room.state = lobbyState(this.room);
    session.playerId = pid;
    await this.persist();
    for (const s of this.sessions) {
      if (s.playerId != null) this.send(s.ws, this.roomPayload(s.playerId));
    }
  }

  private async onMessage(session: Session, data: any) {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)); } catch {
      this.send(session.ws, { type: 'error', message: 'Invalid message' });
      return;
    }

    // init messages (from worker proxy)
    if (msg.type === 'create') {
      const roomId = ((msg as any).roomId || '').toUpperCase().trim();
      const name = (msg.name || 'Player').trim().slice(0, 20) || 'Player';
      await this.handleCreate(session, roomId, name);
      return;
    }
    if (msg.type === 'join') {
      const roomId = (msg.roomId || '').toUpperCase().trim();
      const name = (msg.name || 'Player').trim().slice(0, 20) || 'Player';
      await this.handleJoin(session, roomId, name);
      return;
    }

    if (!this.room || session.playerId == null) {
      this.send(session.ws, { type: 'error', message: 'Join or create a room first' });
      return;
    }
    const room = this.room;
    const playerId = session.playerId;

    if (msg.type === 'start') {
      if (playerId !== room.hostId) return this.send(session.ws, { type: 'error', message: 'Only host can start' });
      if (room.players.length < 2) return this.send(session.ws, { type: 'error', message: 'Need at least 2 players' });
      room.state = createGame(room.players.map((p) => ({ name: p.name })));
      await this.persist();
      this.broadcast({ type: 'state', state: room.state });
      await this.scheduleTurnTimer();
      return;
    }

    if (msg.type === 'move') {
      const result = applyMove(room.state, playerId, msg.r, msg.c);
      if (!result.ok || !result.state) return this.send(session.ws, { type: 'error', message: result.error || 'Invalid move' });
      room.state = result.state;
      await this.persist();
      this.broadcast({ type: 'state', state: room.state, explosions: result.explosions });
      await this.scheduleTurnTimer();
      return;
    }

    if (msg.type === 'rematch') {
      if (playerId !== room.hostId) return this.send(session.ws, { type: 'error', message: 'Only host can start rematch' });
      if (room.players.length < 2) return this.send(session.ws, { type: 'error', message: 'Need at least 2 players' });
      room.state = createGame(room.players.map((p) => ({ name: p.name })));
      await this.persist();
      this.broadcast({ type: 'state', state: room.state });
      await this.scheduleTurnTimer();
      return;
    }
  }

  private async onClose(session: Session) {
    this.sessions.delete(session);
    if (!this.room || session.playerId == null) return;
    const room = this.room;
    const playerId = session.playerId;
    const p = room.players.find((x) => x.id === playerId);
    if (p) p.connected = false;

    if (room.state.status === 'waiting') {
      await this.state.storage.deleteAlarm();
      // removing leaver and reindexing invalidates other session playerIds; simplest: close others to force reconnect
      room.players = room.players.filter((x) => x.id !== playerId);
      room.players.forEach((pl, i) => { pl.id = i; pl.color = PLAYER_COLORS[i]; });
      room.hostId = 0;
      if (room.players.length === 0) {
        this.room = null;
        await this.state.storage.deleteAll();
        return;
      }
      room.state = lobbyState(room);
      await this.persist();
      // notify and close remaining sessions so they rejoin with correct ids
      for (const s of this.sessions) {
        this.send(s.ws, { type: 'error', message: 'Lobby changed, please rejoin' });
        try { s.ws.close(); } catch {}
      }
      this.sessions.clear();
    } else if (room.state.status === 'playing') {
      const leaverId = playerId;
      const board = room.state.board.map(row => row.map(cell => cell.owner === leaverId ? { owner: null, count: 0 } : { ...cell }));
      const players = room.state.players.map(pl => pl.id === leaverId ? { ...pl, alive: false } : { ...pl });
      const alivePlayers = players.filter(pl => pl.alive);
      let nextState: GameState = { ...room.state, board, players };
      const connectedAlive = alivePlayers.filter(pl => room.players.find(rp => rp.id === pl.id)?.connected);
      if (room.state.players.length <= 2 || alivePlayers.length <= 1 || connectedAlive.length <= 1) {
        const winner = alivePlayers.find(pl => room.players.find(rp => rp.id === pl.id)?.connected)?.id ?? (alivePlayers[0]?.id ?? null);
        nextState = { ...nextState, status: 'finished', winner };
        await this.state.storage.deleteAlarm();
      } else {
        if (room.state.players[room.state.currentPlayerIndex]?.id === leaverId) {
          nextState.currentPlayerIndex = nextAliveIndex(nextState, room.state.currentPlayerIndex);
        }
        if (!nextState.players[nextState.currentPlayerIndex]?.alive) {
          nextState.currentPlayerIndex = nextAliveIndex(nextState, nextState.currentPlayerIndex);
        }
      }
      room.state = nextState;
      await this.persist();
      this.broadcast({ type: 'state', state: room.state });
      if (room.state.status === 'playing') await this.scheduleTurnTimer();
    } else {
      await this.persist();
      this.broadcast({ type: 'state', state: room.state });
    }
  }
}
