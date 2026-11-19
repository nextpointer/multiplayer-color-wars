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
} from '../../shared/src/index';

type ConnQuality = 'good' | 'ok' | 'bad' | 'offline';

type ClientMsg =
  | { type: 'create'; name: string; roomId?: string; maxPlayers?: number; grid?: { rows: number; cols: number } | null; shape?: string; gameTimeMinutes?: number | string; teamMode?: string; clientId?: string; tabId?: string }
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

interface Session {
  ws: WebSocket;
  playerId: number | null;
  role?: 'player' | 'spectator';
  spectatorId?: string | null;
  tabId?: string;
  rlWindowStart?: number;
  rlCount?: number;
  rlPenaltyUntil?: number;
}

interface StoredPlayer {
  id: number;
  name: string;
  color: string;
  clientId?: string;
  tabId?: string;
  connected: boolean;
  quality: ConnQuality;
  removed: boolean;
}

interface StoredSpectator {
  id: string;
  name: string;
  clientId?: string;
  tabId?: string;
  connected: boolean;
}

interface StoredRoom {
  id: string;
  hostId: number;
  players: StoredPlayer[];
  spectators?: StoredSpectator[];
  state: GameState;
  chosenGrid?: GridSize | null;
  maxPlayers?: number;
  shape?: BoardShape;
  gameTimeMinutes?: GameTimeMinutes;
  teamMode?: 'off' | '2v2' | '3v3';
}

interface RoomMeta {
  turnDeadline: number | null;
  turnKey: string | null;
}

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

function spectatorsCount(room: StoredRoom): number {
  return (room.spectators || []).filter((s) => s.connected).length;
}

function lobbyState(room: StoredRoom): GameState {
  const chosen = room.chosenGrid ? normalizeGridChoice(room.chosenGrid.rows, room.chosenGrid.cols) : null;
  const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(room.maxPlayers) || 8)));
  const shape = normalizeBoardShape(room.shape);
  const gameTimeMinutes = normalizeGameTimeMinutes(room.gameTimeMinutes);
  room.maxPlayers = maxPlayers;
  room.chosenGrid = chosen;
  room.shape = shape;
  room.gameTimeMinutes = gameTimeMinutes;
  const teamMode = normalizeTeamMode(room.teamMode);
  room.teamMode = teamMode;
  const base = createGame(room.players.map((p) => ({ name: p.name })), chosen?.rows, chosen?.cols, { shape, gameTimeMinutes, maxPlayers, teamMode });
  return {
    ...base,
    status: 'waiting',
    winner: null,
    turnCount: 0,
    currentPlayerIndex: 0,
    turnDeadline: null,
    gameDeadline: null,
    gameDurationMs: gameDurationMsFor(gameTimeMinutes),
    turnDurationMs: FIXED_TURN_MS,
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
        if (!this.room.spectators) this.room.spectators = [];
        if (!this.room.teamMode) this.room.teamMode = 'off';
        if (!this.room.gameTimeMinutes) this.room.gameTimeMinutes = 10;
        this.room.state.gameTimeMinutes = normalizeGameTimeMinutes((this.room.state as any).gameTimeMinutes ?? this.room.gameTimeMinutes);
        (this.room.state as any).gameDurationMs = gameDurationMsFor(this.room.state.gameTimeMinutes as any);
        this.room.state.turnDurationMs = FIXED_TURN_MS;
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
    if (!this.room) return;
    const enriched = (msg.type === 'state' || msg.type === 'presence')
      ? ({ ...msg, spectatorsCount: spectatorsCount(this.room) } as ServerMsg)
      : msg;
    for (const s of this.sessions) {
      if (s.playerId != null || s.spectatorId) this.send(s.ws, enriched);
    }
  }

  private broadcastState(explosions?: { r: number; c: number; owner: number }[]) {
    if (!this.room) return;
    this.broadcast({ type: 'state', state: this.room.state, explosions, players: publicPlayers(this.room), spectatorsCount: spectatorsCount(this.room) });
  }

  private broadcastPresence() {
    if (!this.room) return;
    this.broadcast({ type: 'presence', players: publicPlayers(this.room), spectatorsCount: spectatorsCount(this.room) });
  }

  private roomPayload(playerId: number, opts?: { role?: 'player' | 'spectator'; spectatorId?: string }): ServerMsg {
    const room = this.room!;
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

  private broadcastRoom() {
    if (!this.room) return;
    for (const s of this.sessions) {
      if (s.playerId != null) this.send(s.ws, this.roomPayload(s.playerId, { role: 'player' }));
      else if (s.spectatorId) this.send(s.ws, this.roomPayload(-1, { role: 'spectator', spectatorId: s.spectatorId }));
    }
  }

  private clearTurnTimerMeta() {
    this.meta.turnDeadline = null;
    this.meta.turnKey = null;
  }

  private currentTurnDurationMs(): number {
    if (!this.room) return FIXED_TURN_MS;
    this.room.state.turnDurationMs = FIXED_TURN_MS;
    return FIXED_TURN_MS;
  }

  private syncTurnTimerMeta() {
    if (!this.room) { this.clearTurnTimerMeta(); return; }
    this.room.state.gameTimeMinutes = normalizeGameTimeMinutes((this.room as any).gameTimeMinutes ?? (this.room.state as any).gameTimeMinutes);
    this.room.state.gameDurationMs = gameDurationMsFor(this.room.state.gameTimeMinutes as any);
    if (this.room.state.status === 'playing' && !this.room.state.gameDeadline) {
      this.room.state.gameDeadline = Date.now() + (this.room.state.gameDurationMs || gameDurationMsFor(this.room.gameTimeMinutes));
    }
    if (this.room.state.status !== 'playing') {
      this.room.state.gameDeadline = null;
    }
    const key = turnKeyOf(this.room.state);
    if (!key) {
      this.clearTurnTimerMeta();
      this.room.state.turnDeadline = null;
      this.room.state.turnDurationMs = FIXED_TURN_MS;
      return;
    }
    const duration = this.currentTurnDurationMs();
    if (this.meta.turnKey !== key) {
      this.meta.turnKey = key;
      this.meta.turnDeadline = Date.now() + duration;
    } else if (this.meta.turnDeadline == null) {
      this.meta.turnDeadline = Date.now() + duration;
    }
    this.room.state.turnDeadline = this.meta.turnDeadline;
  }

  private async rescheduleAlarm() {
    if (!this.room) {
      await this.state.storage.deleteAlarm();
      return;
    }
    if (this.room.state.status === 'playing') {
      const times: number[] = [];
      if (this.meta.turnDeadline != null) times.push(this.meta.turnDeadline);
      if (this.room.state.gameDeadline != null) times.push(this.room.state.gameDeadline);
      if (times.length > 0) {
        await this.state.storage.setAlarm(Math.max(Date.now() + 10, Math.min(...times)));
        return;
      }
    }
    await this.state.storage.deleteAlarm();
  }

  private hasOtherSession(playerId: number, except?: Session) {
    for (const s of this.sessions) {
      if (s !== except && s.playerId === playerId) return true;
    }
    return false;
  }

  private async handleCreate(session: Session, roomId: string, name: string, maxPlayersIn?: number, gridIn?: { rows: number; cols: number } | null, shapeIn?: string, gameTimeMinutesIn?: unknown, clientIdIn?: string, teamModeIn?: string, tabIdIn?: string) {
    if (!this.room) {
      const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(maxPlayersIn) || 8)));
      const chosenGrid = gridIn ? normalizeGridChoice((gridIn as any).rows, (gridIn as any).cols) : null;
      const shape = normalizeBoardShape(shapeIn);
      const gameTimeMinutes = normalizeGameTimeMinutes(gameTimeMinutesIn);
      const clientId = typeof clientIdIn === 'string' ? clientIdIn.slice(0, 80) : undefined;
      const tabId = typeof tabIdIn === 'string' ? tabIdIn.slice(0, 80) : undefined;
      const teamMode = normalizeTeamMode(teamModeIn);
      this.room = {
        id: roomId,
        hostId: 0,
        players: [{ id: 0, name, color: PLAYER_COLORS[0], clientId, tabId, connected: true, quality: 'good', removed: false }],
        spectators: [],
        state: null as any,
        chosenGrid,
        maxPlayers,
        shape,
        gameTimeMinutes,
        teamMode: (teamMode === '2v2' && maxPlayers === 4) || (teamMode === '3v3' && maxPlayers === 6) ? teamMode : 'off',
      };
      this.room.state = lobbyState(this.room);
      this.meta = { turnDeadline: null, turnKey: null };
      session.playerId = 0;
      session.role = 'player';
      session.spectatorId = null;
      session.tabId = tabId;
      await this.persist();
      await this.rescheduleAlarm();
      this.send(session.ws, this.roomPayload(0, { role: 'player' }));
      return;
    }
    this.send(session.ws, { type: 'error', message: 'Room already exists' });
  }

  private async handleJoin(session: Session, _roomId: string, name: string, clientIdIn?: string, tabIdIn?: string) {
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
    const clientId = typeof clientIdIn === 'string' ? clientIdIn.slice(0, 80) : undefined;
    if (clientId) {
      const existing = this.room.players.find((p) => p.clientId && p.clientId === clientId);
      if (existing) {
        this.send(session.ws, { type: 'error', message: existing.removed ? 'Player session expired' : 'Already joined this room. Reconnecting…' });
        return;
      }
    }
    const pid = this.room.players.length;
    const tabId = typeof tabIdIn === 'string' ? tabIdIn.slice(0, 80) : undefined;
    this.room.players.push({ id: pid, name, color: PLAYER_COLORS[pid], clientId, tabId, connected: true, quality: 'good', removed: false });
    if (this.room.players.length === 1) this.room.hostId = 0;
    this.room.state = lobbyState(this.room);
    session.playerId = pid;
    session.role = 'player';
    session.spectatorId = null;
    session.tabId = tabId;
    await this.persist();
    await this.rescheduleAlarm();
    this.broadcastRoom();
  }

  private async handleSpectate(session: Session, _roomId: string, name: string, clientIdIn?: string, tabIdIn?: string) {
    if (!this.room) { this.send(session.ws, { type: 'error', message: 'Room not found' }); return; }
    const room = this.room;
    if (!room.spectators) room.spectators = [];
    const clientId = typeof clientIdIn === 'string' ? clientIdIn.slice(0, 80) : undefined;
    const tabId = typeof tabIdIn === 'string' ? tabIdIn.slice(0, 80) : undefined;
    if (clientId && room.players.some((p) => p.clientId === clientId)) {
      this.send(session.ws, { type: 'error', message: 'Already joined as player. Use rejoin.' }); return;
    }
    if (clientId) {
      const existing = room.spectators.find((s) => s.clientId && s.clientId === clientId);
      if (existing) {
        existing.connected = true; existing.name = name; if (tabId) existing.tabId = tabId;
        session.role = 'spectator'; session.spectatorId = existing.id; session.playerId = null;
        session.tabId = tabId;
        await this.persist();
        this.send(session.ws, this.roomPayload(-1, { role: 'spectator', spectatorId: existing.id }));
        this.broadcastPresence();
        return;
      }
    }
    const sid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    room.spectators.push({ id: sid, name, clientId, tabId, connected: true });
    session.role = 'spectator'; session.spectatorId = sid; session.playerId = null;
    session.tabId = tabId;
    await this.persist();
    this.send(session.ws, this.roomPayload(-1, { role: 'spectator', spectatorId: sid }));
    this.broadcastPresence();
  }

  private async handleBecomePlayer(session: Session, nameIn?: string) {
    if (!this.room) { this.send(session.ws, { type: 'error', message: 'Room not found' }); return; }
    const room = this.room;
    if (session.role !== 'spectator' || !session.spectatorId) { this.send(session.ws, { type: 'error', message: 'Not a spectator' }); return; }
    if (room.state.status !== 'waiting') { this.send(session.ws, { type: 'error', message: 'Game already started' }); return; }
    const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(room.maxPlayers ?? room.state.maxPlayers) || 8)));
    if (room.players.length >= maxPlayers) { this.send(session.ws, { type: 'error', message: `Room is full (max ${maxPlayers} players)` }); return; }
    const spec = (room.spectators || []).find((s) => s.id === session.spectatorId);
    if (!spec) { this.send(session.ws, { type: 'error', message: 'Invalid spectator session' }); return; }
    if (spec.clientId && room.players.some((p) => p.clientId === spec.clientId)) {
      this.send(session.ws, { type: 'error', message: 'Already joined as player. Use rejoin.' }); return;
    }
    room.spectators = (room.spectators || []).filter((s) => s.id !== session.spectatorId);
    const pid = room.players.length;
    const name = (nameIn || spec.name || 'Player').trim().slice(0, 20) || 'Player';
    room.players.push({ id: pid, name, color: PLAYER_COLORS[pid], clientId: spec.clientId, tabId: spec.tabId, connected: true, quality: 'good', removed: false });
    if (room.players.length === 1) room.hostId = 0;
    room.state = lobbyState(room);
    session.playerId = pid;
    session.role = 'player';
    session.spectatorId = null;
    await this.persist();
    await this.rescheduleAlarm();
    this.broadcastRoom();
  }

  private async handleRejoin(session: Session, _roomId: string, playerId: number, clientIdIn?: string, tabIdIn?: string) {
    if (!this.room) {
      this.send(session.ws, { type: 'error', message: 'Room not found' });
      return;
    }
    const player = this.room.players.find((p) => p.id === playerId);
    if (!player) {
      this.send(session.ws, { type: 'error', message: 'Player not found in room' });
      return;
    }
    const clientId = typeof clientIdIn === 'string' ? clientIdIn.slice(0, 80) : undefined;
    if (player.clientId && clientId && player.clientId !== clientId) {
      this.send(session.ws, { type: 'error', message: 'Session mismatch' });
      return;
    }
    if (!player.clientId && clientId) player.clientId = clientId;
    const tabId = typeof tabIdIn === 'string' ? tabIdIn.slice(0, 80) : undefined;
    const conflictingTab = !!tabId && !!player.tabId && player.tabId !== tabId && Array.from(this.sessions).some(
      (s) => s !== session && s.playerId === playerId && s.tabId === player.tabId,
    );
    if (conflictingTab) {
      this.send(session.ws, { type: 'error', message: 'Already connected in another tab' });
      return;
    }
    if (tabId) player.tabId = tabId;
    for (const s of Array.from(this.sessions)) {
      if (s !== session && s.playerId === playerId) {
        this.sessions.delete(s);
        try { s.ws.close(4001, 'Session moved'); } catch {}
      }
    }
    player.connected = true;
    if (!player.removed) player.quality = normQuality(player.quality);
    session.playerId = playerId;
    session.role = 'player';
    session.spectatorId = null;
    session.tabId = tabId;
    this.syncTurnTimerMeta();
    await this.persist();
    await this.rescheduleAlarm();
    this.send(session.ws, this.roomPayload(playerId, { role: 'player' }));
    this.broadcastPresence();
  }

  private async removeActivePlayer(playerId: number, opts?: { closeSession?: Session | null }) {
    if (!this.room) return;
    const room = this.room;
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return;
    if (p.removed && room.state.status === 'playing') return;

    if (room.state.status === 'waiting') {
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
      room.hostId = room.players.length > 0 ? 0 : -1;
      this.clearTurnTimerMeta();
      if (room.players.length === 0) {
        room.state = lobbyState(room);
        if (spectatorsCount(room) === 0) {
          this.room = null;
          await this.state.storage.deleteAll();
          for (const s of this.sessions) try { s.ws.close(); } catch {}
          this.sessions.clear();
          return;
        }
        await this.persist();
        await this.rescheduleAlarm();
        this.broadcastRoom();
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

  private checkRate(session: Session, cost = 1, burst = 40, perMs = 10_000) {
    const now = Date.now();
    if ((session.rlPenaltyUntil || 0) > now) return false;
    if (now - (session.rlWindowStart || 0) > perMs) { session.rlWindowStart = now; session.rlCount = 0; }
    session.rlCount = (session.rlCount || 0) + cost;
    if (session.rlCount > burst) { session.rlPenaltyUntil = now + 1500; return false; }
    return true;
  }

  private async onMessage(session: Session, data: any) {
    const raw = typeof data === 'string' ? data : String(data ?? '');
    if (raw.length > 4096) {
      this.send(session.ws, { type: 'error', message: 'Message too large' });
      try { session.ws.close(); } catch {}
      return;
    }
    if (!this.checkRate(session, 1)) {
      this.send(session.ws, { type: 'error', message: 'Too many requests' });
      return;
    }
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch {
      this.send(session.ws, { type: 'error', message: 'Invalid message' });
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.type !== 'string') {
      this.send(session.ws, { type: 'error', message: 'Invalid message' });
      return;
    }
    const msg = parsed as ClientMsg;

    if (msg.type === 'create') {
      const roomId = ((msg as any).roomId || '').toUpperCase().trim();
      const name = (msg.name || 'Player').trim().slice(0, 20) || 'Player';
      if (session.playerId != null || session.spectatorId) { this.send(session.ws, { type: 'error', message: 'Already in a room' }); return; }
      if (!this.checkRate(session, 5)) { this.send(session.ws, { type: 'error', message: 'Too many requests' }); return; }
      await this.handleCreate(session, roomId, name, (msg as any).maxPlayers, (msg as any).grid, (msg as any).shape, (msg as any).gameTimeMinutes, (msg as any).clientId, (msg as any).teamMode, (msg as any).tabId);
      return;
    }
    if (msg.type === 'join') {
      const roomId = ((msg as any).roomId || '').toUpperCase().trim();
      const name = ((msg as any).name || 'Player').trim().slice(0, 20) || 'Player';
      if (session.playerId != null || session.spectatorId) { this.send(session.ws, { type: 'error', message: 'Already in a room' }); return; }
      if (!this.checkRate(session, 4)) { this.send(session.ws, { type: 'error', message: 'Too many requests' }); return; }
      await this.handleJoin(session, roomId, name, (msg as any).clientId, (msg as any).tabId);
      return;
    }
    if (msg.type === 'spectate') {
      const roomId = ((msg as any).roomId || '').toUpperCase().trim();
      const name = ((msg as any).name || 'Spectator').trim().slice(0, 20) || 'Spectator';
      if (session.playerId != null || session.spectatorId) { this.send(session.ws, { type: 'error', message: 'Already in a room' }); return; }
      if (!this.checkRate(session, 4)) { this.send(session.ws, { type: 'error', message: 'Too many requests' }); return; }
      await this.handleSpectate(session, roomId, name, (msg as any).clientId, (msg as any).tabId);
      return;
    }

    if (msg.type === 'rejoin') {
      const roomId = ((msg as any).roomId || '').toUpperCase().trim();
      const pid = Number((msg as any).playerId);
      if (!Number.isInteger(pid) || pid < 0 || pid > 99) { this.send(session.ws, { type: 'error', message: 'Invalid player session' }); return; }
      if (!this.checkRate(session, 4)) { this.send(session.ws, { type: 'error', message: 'Too many requests' }); return; }
      await this.handleRejoin(session, roomId, pid, (msg as any).clientId, (msg as any).tabId);
      return;
    }
    if (msg.type === 'ping') {
      const ts = typeof (msg as any).ts === 'number' && Number.isFinite((msg as any).ts) ? (msg as any).ts : undefined;
      this.send(session.ws, { type: 'pong', ts });
      return;
    }
    if (msg.type === 'quality') {
      if (!this.room || session.playerId == null) return;
      if (!this.checkRate(session, 2)) return;
      const p = this.room.players.find((x) => x.id === session.playerId);
      if (p) {
        p.quality = normQuality((msg as any).quality);
        await this.persist();
        this.broadcastPresence();
      }
      return;
    }

    if (!this.room || (session.role !== 'spectator' && session.playerId == null) || (session.role === 'spectator' && !session.spectatorId)) {
      this.send(session.ws, { type: 'error', message: 'Join or create a room first' });
      return;
    }
    const room = this.room;
    if (session.role === 'spectator') {
      if (msg.type === 'leave') {
        room.spectators = (room.spectators || []).filter((s) => s.id !== session.spectatorId);
        session.spectatorId = null; session.role = undefined; session.playerId = null;
        await this.persist();
        this.broadcastPresence();
        try { session.ws.close(); } catch {}
        return;
      }
      if (msg.type === 'become_player') {
        if (!this.checkRate(session, 4)) { this.send(session.ws, { type: 'error', message: 'Too many requests' }); return; }
        await this.handleBecomePlayer(session, (msg as any).name);
        return;
      }
      this.send(session.ws, { type: 'error', message: 'Spectators cannot perform this action' });
      return;
    }
    const playerId = session.playerId as number;

    if (msg.type === 'leave') {
      await this.removeActivePlayer(playerId, { closeSession: session });
      return;
    }

    if (msg.type === 'start') {
      if (!this.checkRate(session, 3)) { this.send(session.ws, { type: 'error', message: 'Too many requests' }); return; }
      if (playerId !== room.hostId) return this.send(session.ws, { type: 'error', message: 'Only host can start' });
      if (room.state.status !== 'waiting') return this.send(session.ws, { type: 'error', message: 'Game already started' });
      if (room.players.length < 2) return this.send(session.ws, { type: 'error', message: 'Need at least 2 players' });
      const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(room.maxPlayers ?? room.state.maxPlayers) || 8)));
      const teamMode = normalizeTeamMode(room.teamMode);
      if (teamMode !== 'off' && !isValidTeamModeForPlayers(teamMode, room.players.length)) {
        return this.send(session.ws, { type: 'error', message: `Team mode ${teamMode} requires ${teamMode === '2v2' ? 4 : 6} players` });
      }
      room.state = createGame(room.players.map((p) => ({ name: p.name })), room.state.rows, room.state.cols, { shape: normalizeBoardShape(room.shape), gameTimeMinutes: normalizeGameTimeMinutes(room.gameTimeMinutes), maxPlayers, teamMode });
      for (const p of room.players) { p.removed = false; if (p.connected) p.quality = normQuality(p.quality); }
      this.syncTurnTimerMeta();
      await this.persist();
      this.broadcastState();
      await this.rescheduleAlarm();
      return;
    }

    if (msg.type === 'move') {
      if (!this.checkRate(session, 2)) { this.send(session.ws, { type: 'error', message: 'Too many requests' }); return; }
      const playerRec = room.players.find((p) => p.id === playerId);
      if (!playerRec || playerRec.removed) return this.send(session.ws, { type: 'error', message: 'You left the game' });
      if (isGameTimeExpired(room.state)) {
        room.state = finishGameByTime(room.state);
        this.clearTurnTimerMeta();
        await this.persist();
        this.broadcastState();
        await this.rescheduleAlarm();
        return;
      }
      const r = Number((msg as any).r), c = Number((msg as any).c);
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r > 100 || c > 100) return this.send(session.ws, { type: 'error', message: 'Invalid move' });
      const result = applyMove(room.state, playerId, r, c);
      if (!result.ok || !result.state) return this.send(session.ws, { type: 'error', message: result.error || 'Invalid move' });
      room.state = result.state;
      this.syncTurnTimerMeta();
      await this.persist();
      this.broadcastState(result.explosions);
      await this.rescheduleAlarm();
      return;
    }

    if (msg.type === 'rematch') {
      if (!this.checkRate(session, 3)) { this.send(session.ws, { type: 'error', message: 'Too many requests' }); return; }
      if (playerId !== room.hostId) return this.send(session.ws, { type: 'error', message: 'Only host can start rematch' });
      if (room.state.status === 'playing') return this.send(session.ws, { type: 'error', message: 'Game still in progress' });
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
    if (!this.room) return;
    const room = this.room;
    if (session.role === 'spectator' || session.spectatorId) {
      if (session.spectatorId) {
        room.spectators = (room.spectators || []).filter((s) => s.id !== session.spectatorId);
        await this.persist();
        this.broadcastPresence();
      }
      return;
    }
    if (session.playerId == null) return;
    const playerId = session.playerId;
    if (this.hasOtherSession(playerId)) return;
    const p = room.players.find((x) => x.id === playerId);

    if (room.state.status === 'waiting') {
      await this.removeActivePlayer(playerId);
      return;
    }

    if (room.state.status === 'playing') {
      if (p) {
        p.connected = false;
        p.quality = 'offline';
        await this.persist();
        this.broadcastPresence();
        await this.rescheduleAlarm();
      }
      return;
    }

    // finished
    if (p) {
      p.connected = false;
      p.quality = 'offline';
      await this.persist();
      this.broadcastPresence();
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
      if (this.room.state.gameDeadline != null && this.room.state.gameDeadline <= now) {
        this.room.state = finishGameByTime(this.room.state);
        this.clearTurnTimerMeta();
        changed = true;
      } else {
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
              this.room.state.turnDurationMs = FIXED_TURN_MS;
              lastExplosions = undefined;
              changed = true;
            }
          } else {
            changed = true;
          }
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
