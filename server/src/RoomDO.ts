import {
  applyMove,
  createEmptyBoard,
  createGame,
  getValidMoves,
  recommendedBoardSize,
  removePlayerCells,
  type GameState,
  PLAYER_COLORS,
} from '../../shared/src/index';

type ClientMsg =
  | { type: 'create'; name: string; roomId?: string }
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
}

interface RoomMeta {
  turnDeadline: number | null;
  turnKey: string | null;
  goneDeadlines: Record<string, number>;
}

const TURN_MS = 3 * 60_000;
const GONE_MS = 3 * 60_000;

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

function turnKeyOf(state: GameState): string | null {
  if (state.status !== 'playing') return null;
  const cur = state.players[state.currentPlayerIndex];
  if (!cur || !cur.alive) return null;
  return `${state.turnCount}:${state.currentPlayerIndex}:${cur.id}`;
}

export class RoomDO {
  state: DurableObjectState;
  sessions: Set<Session> = new Set();
  room: StoredRoom | null = null;
  meta: RoomMeta = { turnDeadline: null, turnKey: null, goneDeadlines: {} };

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      this.room = (await this.state.storage.get<StoredRoom>('room')) || null;
      this.meta = (await this.state.storage.get<RoomMeta>('meta')) || { turnDeadline: null, turnKey: null, goneDeadlines: {} };
      if (!this.meta.goneDeadlines) this.meta.goneDeadlines = {};
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
    else await this.state.storage.delete('room');
    await this.state.storage.put('meta', this.meta);
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  private broadcast(msg: ServerMsg) {
    for (const s of this.sessions) {
      if (s.playerId != null) this.send(s.ws, msg);
    }
  }

  private broadcastState(explosions?: { r: number; c: number; owner: number }[]) {
    if (!this.room) return;
    this.broadcast({ type: 'state', state: this.room.state, explosions });
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

  private clearTurnTimerMeta() {
    this.meta.turnDeadline = null;
    this.meta.turnKey = null;
  }

  private syncTurnTimerMeta() {
    if (!this.room) { this.clearTurnTimerMeta(); return; }
    const key = turnKeyOf(this.room.state);
    if (!key) { this.clearTurnTimerMeta(); return; }
    if (this.meta.turnKey !== key) {
      this.meta.turnKey = key;
      this.meta.turnDeadline = Date.now() + TURN_MS;
    } else if (this.meta.turnDeadline == null) {
      this.meta.turnDeadline = Date.now() + TURN_MS;
    }
  }

  private async rescheduleAlarm() {
    if (!this.room) {
      await this.state.storage.deleteAlarm();
      return;
    }
    const times: number[] = [];
    if (this.meta.turnDeadline != null && this.room.state.status === 'playing') times.push(this.meta.turnDeadline);
    for (const t of Object.values(this.meta.goneDeadlines || {})) if (typeof t === 'number') times.push(t);
    if (times.length === 0) {
      await this.state.storage.deleteAlarm();
      return;
    }
    const next = Math.min(...times);
    await this.state.storage.setAlarm(Math.max(Date.now() + 10, next));
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
      this.meta = { turnDeadline: null, turnKey: null, goneDeadlines: {} };
      session.playerId = 0;
      await this.persist();
      await this.rescheduleAlarm();
      this.send(session.ws, this.roomPayload(0));
      return;
    }
    this.send(session.ws, { type: 'error', message: 'Room already exists' });
  }

  private async handleJoin(session: Session, _roomId: string, name: string) {
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
    await this.rescheduleAlarm();
    for (const s of this.sessions) {
      if (s.playerId != null) this.send(s.ws, this.roomPayload(s.playerId));
    }
  }

  private async handleRejoin(session: Session, _roomId: string, playerId: number) {
    if (!this.room) {
      this.send(session.ws, { type: 'error', message: 'Room not found' });
      return;
    }
    const player = this.room.players.find((p) => p.id === playerId);
    if (!player) {
      this.send(session.ws, { type: 'error', message: 'Player not found in room' });
      return;
    }
    for (const s of Array.from(this.sessions)) {
      if (s !== session && s.playerId === playerId) {
        this.sessions.delete(s);
        try { s.ws.close(); } catch {}
      }
    }
    player.connected = true;
    delete this.meta.goneDeadlines[String(playerId)];
    session.playerId = playerId;
    this.syncTurnTimerMeta();
    await this.persist();
    await this.rescheduleAlarm();
    this.send(session.ws, this.roomPayload(playerId));
  }

  private async onMessage(session: Session, data: any) {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)); } catch {
      this.send(session.ws, { type: 'error', message: 'Invalid message' });
      return;
    }

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
    if (msg.type === 'rejoin') {
      const roomId = (msg.roomId || '').toUpperCase().trim();
      const pid = Number((msg as any).playerId);
      await this.handleRejoin(session, roomId, pid);
      return;
    }
    if (msg.type === 'ping') {
      this.send(session.ws, { type: 'pong' });
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
      this.meta.goneDeadlines = {};
      this.syncTurnTimerMeta();
      await this.persist();
      this.broadcastState();
      await this.rescheduleAlarm();
      return;
    }

    if (msg.type === 'move') {
      const result = applyMove(room.state, playerId, msg.r, msg.c);
      if (!result.ok || !result.state) return this.send(session.ws, { type: 'error', message: result.error || 'Invalid move' });
      room.state = result.state;
      this.syncTurnTimerMeta();
      await this.persist();
      this.broadcastState(result.explosions);
      await this.rescheduleAlarm();
      return;
    }

    if (msg.type === 'rematch') {
      if (playerId !== room.hostId) return this.send(session.ws, { type: 'error', message: 'Only host can start rematch' });
      if (room.players.length < 2) return this.send(session.ws, { type: 'error', message: 'Need at least 2 players' });
      room.state = createGame(room.players.map((p) => ({ name: p.name })));
      this.meta.goneDeadlines = {};
      this.syncTurnTimerMeta();
      await this.persist();
      this.broadcastState();
      await this.rescheduleAlarm();
      return;
    }
  }

  private async onClose(session: Session) {
    this.sessions.delete(session);
    if (!this.room || session.playerId == null) return;
    const room = this.room;
    const playerId = session.playerId;
    for (const s of this.sessions) {
      if (s.playerId === playerId) return;
    }
    const p = room.players.find((x) => x.id === playerId);
    if (p) p.connected = false;

    if (room.state.status === 'waiting') {
      await this.state.storage.deleteAlarm();
      room.players = room.players.filter((x) => x.id !== playerId);
      room.players.forEach((pl, i) => { pl.id = i; pl.color = PLAYER_COLORS[i]; });
      room.hostId = 0;
      this.meta = { turnDeadline: null, turnKey: null, goneDeadlines: {} };
      if (room.players.length === 0) {
        this.room = null;
        await this.state.storage.deleteAll();
        return;
      }
      room.state = lobbyState(room);
      await this.persist();
      for (const s of this.sessions) {
        this.send(s.ws, { type: 'error', message: 'Lobby changed, please rejoin' });
        try { s.ws.close(); } catch {}
      }
      this.sessions.clear();
    } else if (room.state.status === 'playing') {
      // keep player for rejoin, but remove their cells if they stay gone
      this.meta.goneDeadlines[String(playerId)] = Date.now() + GONE_MS;
      this.syncTurnTimerMeta();
      await this.persist();
      this.broadcastState();
      await this.rescheduleAlarm();
    } else {
      await this.persist();
      this.broadcastState();
      await this.rescheduleAlarm();
    }
  }

  async alarm(): Promise<void> {
    if (!this.room) {
      await this.state.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    let changed = false;
    let lastExplosions: { r: number; c: number; owner: number }[] | undefined;

    // 1) remove players who have been disconnected/gone past grace period
    const goneIds = Object.entries(this.meta.goneDeadlines || {})
      .filter(([, t]) => typeof t === 'number' && t <= now)
      .map(([id]) => Number(id));
    for (const pid of goneIds) {
      delete this.meta.goneDeadlines[String(pid)];
      const p = this.room.players.find((x) => x.id === pid);
      if (!p || p.connected) continue;
      if (this.room.state.status !== 'playing') continue;
      this.room.state = removePlayerCells(this.room.state, pid);
      changed = true;
      lastExplosions = undefined;
      if (this.room.state.status !== 'playing') break;
    }

    // 2) auto-play turn if deadline expired for the current turn
    if (this.room.state.status === 'playing') {
      const key = turnKeyOf(this.room.state);
      if (key && this.meta.turnKey === key && this.meta.turnDeadline != null && this.meta.turnDeadline <= now) {
        const current = this.room.state.players[this.room.state.currentPlayerIndex];
        if (current && current.alive) {
          const moves = getValidMoves(this.room.state, current.id);
          if (moves.length > 0) {
            const move = moves[Math.floor(Math.random() * moves.length)];
            const result = applyMove(this.room.state, current.id, move.r, move.c);
            if (result.ok && result.state) {
              this.room.state = result.state;
              lastExplosions = result.explosions;
              changed = true;
            } else {
              // avoid stall: push deadline forward slightly
              this.meta.turnDeadline = now + 5_000;
            }
          } else {
            this.room.state = removePlayerCells(this.room.state, current.id);
            lastExplosions = undefined;
            changed = true;
          }
        } else {
          changed = true;
        }
      }
    }

    // sync next turn deadline after any state changes
    this.syncTurnTimerMeta();
    if (changed) {
      await this.persist();
      this.broadcastState(lastExplosions);
    } else {
      await this.persist();
    }
    await this.rescheduleAlarm();
  }
}
