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
} from '../../shared/src/index';

type ConnQuality = 'good' | 'ok' | 'bad' | 'offline';

type ClientMsg =
  | { type: 'create'; name: string; roomId?: string; maxPlayers?: number; grid?: { rows: number; cols: number } | null }
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

interface Session {
  ws: WebSocket;
  playerId: number | null;
}

interface StoredPlayer {
  id: number;
  name: string;
  color: string;
  connected: boolean;
  quality?: ConnQuality;
  removed?: boolean;
}

interface StoredRoom {
  id: string;
  hostId: number;
  players: StoredPlayer[];
  state: GameState;
  chosenGrid?: GridSize | null;
  maxPlayers?: number;
}

interface RoomMeta {
  turnDeadline: number | null;
  turnKey: string | null;
}

const TURN_MS = 60_000;

function normQuality(q: any): ConnQuality {
  return q === 'good' || q === 'ok' || q === 'bad' ? q : 'good';
}

function publicPlayers(room: StoredRoom): PublicPlayer[] {
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    connected: !!p.connected,
    quality: p.connected ? normQuality(p.quality) : 'offline',
  }));
}

function lobbyState(room: StoredRoom): GameState {
  const chosen = room.chosenGrid ? normalizeGridChoice(room.chosenGrid.rows, room.chosenGrid.cols) : null;
  const size = chosen || recommendedBoardSize(Math.max(room.players.length, 2));
  const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(room.maxPlayers) || 8)));
  room.maxPlayers = maxPlayers;
  room.chosenGrid = chosen;
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
    maxPlayers,
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
  meta: RoomMeta = { turnDeadline: null, turnKey: null };

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      this.room = (await this.state.storage.get<StoredRoom>('room')) || null;
      const m = (await this.state.storage.get<any>('meta')) || null;
      this.meta = {
        turnDeadline: m?.turnDeadline ?? null,
        turnKey: m?.turnKey ?? null,
      };
      if (this.room) {
        for (const p of this.room.players) {
          if (!p.quality) p.quality = p.connected ? 'good' : 'offline';
          if (p.removed == null) p.removed = false;
        }
      }
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
    this.broadcast({ type: 'state', state: this.room.state, explosions, players: publicPlayers(this.room) });
  }

  private broadcastPresence() {
    if (!this.room) return;
    this.broadcast({ type: 'presence', players: publicPlayers(this.room) });
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

  private broadcastRoom() {
    if (!this.room) return;
    for (const s of this.sessions) {
      if (s.playerId != null) this.send(s.ws, this.roomPayload(s.playerId));
    }
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
    if (this.meta.turnDeadline != null && this.room.state.status === 'playing') {
      await this.state.storage.setAlarm(Math.max(Date.now() + 10, this.meta.turnDeadline));
      return;
    }
    await this.state.storage.deleteAlarm();
  }

  private hasOtherSession(playerId: number, except?: Session) {
    for (const s of this.sessions) {
      if (s !== except && s.playerId === playerId) return true;
    }
    return false;
  }

  private async handleCreate(session: Session, roomId: string, name: string, maxPlayersIn?: number, gridIn?: { rows: number; cols: number } | null) {
    if (!this.room) {
      const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(maxPlayersIn) || 8)));
      const chosenGrid = gridIn ? normalizeGridChoice((gridIn as any).rows, (gridIn as any).cols) : null;
      this.room = {
        id: roomId,
        hostId: 0,
        players: [{ id: 0, name, color: PLAYER_COLORS[0], connected: true, quality: 'good', removed: false }],
        state: null as any,
        chosenGrid,
        maxPlayers,
      };
      this.room.state = lobbyState(this.room);
      this.meta = { turnDeadline: null, turnKey: null };
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
    const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(this.room.maxPlayers ?? this.room.state.maxPlayers) || 8)));
    if (this.room.players.length >= maxPlayers) {
      this.send(session.ws, { type: 'error', message: `Room is full (max ${maxPlayers} players)` });
      return;
    }
    const pid = this.room.players.length;
    this.room.players.push({ id: pid, name, color: PLAYER_COLORS[pid], connected: true, quality: 'good', removed: false });
    this.room.state = lobbyState(this.room);
    session.playerId = pid;
    await this.persist();
    await this.rescheduleAlarm();
    this.broadcastRoom();
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
    if (!player.removed) player.quality = normQuality(player.quality);
    session.playerId = playerId;
    this.syncTurnTimerMeta();
    await this.persist();
    await this.rescheduleAlarm();
    this.send(session.ws, this.roomPayload(playerId));
    this.broadcastPresence();
  }

  private async removeActivePlayer(playerId: number, opts?: { closeSession?: Session | null }) {
    if (!this.room) return;
    const room = this.room;
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return;
    if (p.removed && room.state.status === 'playing') return;

    if (room.state.status === 'waiting') {
      // remove from lobby and reindex; keep other connected players in the same room
      const removedId = playerId;
      for (const s of Array.from(this.sessions)) {
        if (s.playerId === removedId) {
          this.sessions.delete(s);
          try { s.ws.close(); } catch {}
        } else if (s.playerId != null && s.playerId > removedId) {
          s.playerId = s.playerId - 1;
        }
      }
      room.players = room.players.filter((x) => x.id !== removedId);
      room.players.forEach((pl, i) => {
        pl.id = i;
        pl.color = PLAYER_COLORS[i];
        pl.removed = false;
        if (pl.connected) pl.quality = normQuality(pl.quality);
      });
      room.hostId = 0;
      this.clearTurnTimerMeta();
      if (room.players.length === 0) {
        this.room = null;
        await this.state.storage.deleteAll();
        for (const s of this.sessions) try { s.ws.close(); } catch {}
        this.sessions.clear();
        return;
      }
      room.state = lobbyState(room);
      await this.persist();
      await this.rescheduleAlarm();
      this.broadcastRoom();
      return;
    }

    if (room.state.status === 'playing') {
      p.removed = true;
      p.connected = false;
      p.quality = 'offline';
      // close sessions for this player
      for (const s of Array.from(this.sessions)) {
        if (s.playerId === playerId) {
          this.sessions.delete(s);
          try { s.ws.close(); } catch {}
        }
      }
      room.state = removePlayerCells(room.state, playerId);
      this.syncTurnTimerMeta();
      await this.persist();
      this.broadcastState();
      await this.rescheduleAlarm();
      return;
    }

    // finished/other: just mark disconnected
    p.connected = false;
    p.quality = 'offline';
    for (const s of Array.from(this.sessions)) {
      if (s.playerId === playerId) {
        this.sessions.delete(s);
        try { s.ws.close(); } catch {}
      }
    }
    await this.persist();
    this.broadcastPresence();
    await this.rescheduleAlarm();
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
      await this.handleCreate(session, roomId, name, (msg as any).maxPlayers, (msg as any).grid);
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
      this.send(session.ws, { type: 'pong', ts: (msg as any).ts });
      return;
    }
    if (msg.type === 'quality') {
      if (!this.room || session.playerId == null) return;
      const p = this.room.players.find(x => x.id === session.playerId);
      if (p) {
        p.quality = normQuality((msg as any).quality);
        await this.persist();
        this.broadcastPresence();
      }
      return;
    }

    if (!this.room || session.playerId == null) {
      this.send(session.ws, { type: 'error', message: 'Join or create a room first' });
      return;
    }
    const room = this.room;
    const playerId = session.playerId;

    if (msg.type === 'leave') {
      await this.removeActivePlayer(playerId, { closeSession: session });
      return;
    }

    if (msg.type === 'start') {
      if (playerId !== room.hostId) return this.send(session.ws, { type: 'error', message: 'Only host can start' });
      if (room.players.length < 2) return this.send(session.ws, { type: 'error', message: 'Need at least 2 players' });
      const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(room.maxPlayers ?? room.state.maxPlayers) || 8)));
      room.state = createGame(room.players.map((p) => ({ name: p.name })), room.state.rows, room.state.cols);
      room.state.maxPlayers = maxPlayers;
      for (const p of room.players) { p.removed = false; if (p.connected) p.quality = normQuality(p.quality); }
      this.syncTurnTimerMeta();
      await this.persist();
      this.broadcastState();
      await this.rescheduleAlarm();
      return;
    }

    if (msg.type === 'move') {
      const playerRec = room.players.find(p => p.id === playerId);
      if (playerRec?.removed) return this.send(session.ws, { type: 'error', message: 'You left the game' });
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
      this.clearTurnTimerMeta();
      for (const p of room.players) { p.removed = false; if (p.connected) p.quality = normQuality(p.quality); else p.quality = 'offline'; }
      room.state = lobbyState(room);
      await this.persist();
      this.broadcastRoom();
      await this.rescheduleAlarm();
      return;
    }
  }

  private async onClose(session: Session) {
    this.sessions.delete(session);
    if (!this.room || session.playerId == null) return;
    const playerId = session.playerId;
    if (this.hasOtherSession(playerId)) return;
    const room = this.room;
    const p = room.players.find((x) => x.id === playerId);

    if (room.state.status === 'waiting') {
      await this.removeActivePlayer(playerId);
      return;
    }

    if (room.state.status === 'playing') {
      // player left/disconnected: vanish their cells immediately
      await this.removeActivePlayer(playerId);
      return;
    }

    if (p) {
      p.connected = false;
      p.quality = 'offline';
      await this.persist();
      this.broadcastPresence();
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
