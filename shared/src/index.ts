export type PlayerId = number;

export interface Cell {
  owner: PlayerId | null;
  count: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  alive: boolean;
  hasPlayed: boolean;
  team?: number; // 0-based team id for team mode
}

export type GameStatus = 'waiting' | 'playing' | 'finished';

export type BoardShape = 'square' | 'rectangle' | 'diamond' | 'circle' | 'heart' | 'triangle' | 'cross' | 'ring';
export type GameTimeMinutes = 10 | 20 | 30;
export const FIXED_TURN_MS = 60_000;

export interface GameState {
  rows: number;
  cols: number;
  board: Cell[][];
  players: PlayerState[];
  currentPlayerIndex: number; // index into players array (active turn order)
  status: GameStatus;
  winner: PlayerId | null;
  turnCount: number;
  maxPlayers: number;
  shape?: BoardShape;
  mask?: boolean[][]; // playable cells mask; undefined/null => full rectangle
  /** Overall game timer selection in minutes. */
  gameTimeMinutes?: GameTimeMinutes;
  /** Overall game duration in ms (derived from gameTimeMinutes). */
  gameDurationMs?: number | null;
  /** Epoch ms when the whole game expires (server time reference). */
  gameDeadline?: number | null;
  /** Fixed per-turn duration in ms (always 60s during play). */
  turnDurationMs?: number | null;
  /** Epoch ms when current turn expires (server time reference). */
  turnDeadline?: number | null;
  teamMode?: 'off' | '2v2' | '3v3' | 'ffa';
  teamsCount?: number;
}

export const PLAYER_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#a855f7', // purple
  '#f97316', // orange
  '#06b6d4', // cyan
  '#ec4899', // pink
];

export interface GridSize { rows: number; cols: number; }

export function recommendedBoardSize(playerCount: number): GridSize {
  if (playerCount <= 2) return { rows: 6, cols: 9 };
  if (playerCount <= 4) return { rows: 9, cols: 9 };
  if (playerCount <= 6) return { rows: 9, cols: 12 };
  return { rows: 10, cols: 15 }; // 7-8 players
}

export function normalizeGridChoice(rows: unknown, cols: unknown): GridSize | null {
  const r = Math.round(Number(rows));
  const c = Math.round(Number(cols));
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  if (r < 4 || c < 4 || r > 20 || c > 30) return null;
  return { rows: r, cols: c };
}

export function gridOptionsForPlayers(playerCount: number): GridSize[] {
  const n = Math.max(2, Math.min(8, Math.floor(Number(playerCount) || 2)));
  const rec = recommendedBoardSize(n);
  const base: GridSize[] = n <= 2
    ? [{ rows: 5, cols: 7 }, { rows: 6, cols: 9 }, { rows: 7, cols: 10 }, { rows: 9, cols: 9 }]
    : n <= 4
      ? [{ rows: 6, cols: 9 }, { rows: 7, cols: 10 }, { rows: 9, cols: 9 }, { rows: 9, cols: 12 }, { rows: 10, cols: 12 }]
      : n <= 6
        ? [{ rows: 9, cols: 9 }, { rows: 9, cols: 12 }, { rows: 10, cols: 12 }, { rows: 10, cols: 15 }, { rows: 12, cols: 12 }]
        : [{ rows: 9, cols: 12 }, { rows: 10, cols: 15 }, { rows: 12, cols: 12 }, { rows: 12, cols: 15 }, { rows: 12, cols: 18 }, { rows: 14, cols: 18 }];
  const key = (g: GridSize) => `${g.rows}x${g.cols}`;
  const seen = new Set<string>();
  const out: GridSize[] = [];
  for (const g of [rec, ...base]) {
    const k = key(g);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
  }
  return out.sort((a, b) => (a.rows * a.cols) - (b.rows * b.cols) || a.rows - b.rows || a.cols - b.cols);
}

export function normalizeGameTimeMinutes(value: unknown): GameTimeMinutes {
  const n = Math.round(Number(value));
  if (n === 10 || n === 20 || n === 30) return n;
  const s = String(value ?? '').trim();
  if (s === '10') return 10;
  if (s === '20') return 20;
  if (s === '30') return 30;
  return 10;
}

export function gameDurationMsFor(minutes: unknown): number {
  return normalizeGameTimeMinutes(minutes) * 60_000;
}

/** Per-turn duration is fixed at 1 minute for all games. */
export function turnDurationMsFor(_gameTimeMinutes?: unknown, _playerCount?: number): number {
  return FIXED_TURN_MS;
}

export function totalOrbCount(state: Pick<GameState, 'rows' | 'cols' | 'board' | 'mask'>, playerId: PlayerId): number {
  let n = 0;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (!isPlayable(state as any, r, c)) continue;
      const cell = state.board[r][c];
      if (cell.owner === playerId) n += cell.count;
    }
  }
  return n;
}

export function ownedCellCount(state: Pick<GameState, 'rows' | 'cols' | 'board' | 'mask'>, playerId: PlayerId): number {
  let n = 0;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (!isPlayable(state as any, r, c)) continue;
      if (state.board[r][c].owner === playerId) n++;
    }
  }
  return n;
}

/**
 * Finish the game because the overall game timer expired. Winner is the alive
 * player/team with the most orbs, then most owned cells, then lowest id.
 */
export function finishGameByTime(state: GameState): GameState {
  if (state.status === 'finished') return state;
  const next: GameState = { ...state, status: 'finished', turnDeadline: null };
  const teamModeOn = next.teamMode && next.teamMode !== 'off' && next.teamMode !== 'ffa';
  if (teamModeOn) {
    const teamIds = Array.from(new Set(next.players.map(p => (typeof p.team === 'number' ? p.team : -1)).filter(t => t >= 0)));
    let best: { team: number; orbs: number; cells: number; rep: number } | null = null;
    for (const team of teamIds) {
      const members = next.players.filter(p => p.team === team);
      if (members.length === 0) continue;
      const orbs = members.reduce((sum, p) => sum + totalOrbCount(next, p.id), 0);
      const cells = members.reduce((sum, p) => sum + ownedCellCount(next, p.id), 0);
      const rep = (members.find(p => p.alive) || members[0]).id;
      if (!best || orbs > best.orbs || (orbs === best.orbs && cells > best.cells) || (orbs === best.orbs && cells === best.cells && rep < best.rep)) {
        best = { team, orbs, cells, rep };
      }
    }
    next.winner = best ? best.rep : null;
    return next;
  }
  let best: { id: number; orbs: number; cells: number } | null = null;
  for (const p of next.players) {
    if (!p.alive && p.hasPlayed) {
      // eliminated players can still be compared? usually not; prefer alive
    }
    const orbs = totalOrbCount(next, p.id);
    const cells = ownedCellCount(next, p.id);
    const aliveBonus = p.alive ? 1 : 0;
    const bestAlive = best ? (next.players.find(x => x.id === best!.id)?.alive ? 1 : 0) : -1;
    if (!best
      || aliveBonus > bestAlive
      || (aliveBonus === bestAlive && orbs > best.orbs)
      || (aliveBonus === bestAlive && orbs === best.orbs && cells > best.cells)
      || (aliveBonus === bestAlive && orbs === best.orbs && cells === best.cells && p.id < best.id)) {
      best = { id: p.id, orbs, cells };
    }
  }
  next.winner = best ? best.id : null;
  return next;
}

export function normalizeBoardShape(value: unknown): BoardShape {
  const v = String(value ?? 'rectangle');
  if (v === 'square' || v === 'rectangle' || v === 'diamond' || v === 'circle' || v === 'heart' || v === 'triangle' || v === 'cross' || v === 'ring') return v;
  return 'rectangle';
}

export const BOARD_SHAPES: { id: BoardShape; label: string }[] = [
  { id: 'rectangle', label: 'Grid' },
  { id: 'square', label: 'Square' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'circle', label: 'Circle' },
  { id: 'heart', label: 'Heart' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'cross', label: 'Cross' },
  { id: 'ring', label: 'Ring' },
];

export function createBoardMask(rows: number, cols: number, shape?: BoardShape): boolean[][] | undefined {
  const s = shape || 'rectangle';
  if (s === 'rectangle' || s === 'square') return undefined;
  const mask: boolean[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const rx = Math.max(0.5, (cols - 1) / 2);
  const ry = Math.max(0.5, (rows - 1) / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const nx2 = (c - cx) / Math.max(1, rx);
      const ny2 = (r - cy) / Math.max(1, ry);
      let ok = false;
      if (s === 'diamond') {
        ok = Math.abs(nx2) + Math.abs(ny2) <= 1.05;
      } else if (s === 'circle') {
        ok = (nx2 * nx2 + ny2 * ny2) <= 1.05;
      } else if (s === 'triangle') {
        // upward triangle
        const yn = (r / Math.max(1, rows - 1)); // 0 top .. 1 bottom
        const half = 0.06 + (1 - yn) * 0.54;
        ok = Math.abs((c - cx) / Math.max(1, cols - 1)) <= half && r >= Math.floor(rows * 0.05);
      } else if (s === 'cross') {
        const armX = Math.max(1, Math.round(cols * 0.22));
        const armY = Math.max(1, Math.round(rows * 0.22));
        ok = Math.abs(c - cx) <= armX || Math.abs(r - cy) <= armY;
      } else if (s === 'ring') {
        const d2 = nx2 * nx2 + ny2 * ny2;
        ok = d2 <= 1.05 && d2 >= 0.28;
      } else if (s === 'heart') {
        // implicit heart curve normalized to box
        const x = ((c - cx) / Math.max(1, rx)) * 1.15;
        const y = ((cy - r) / Math.max(1, ry)) * 1.2; // invert y so top lobes up
        const a = x * x + y * y - 1;
        ok = (a * a * a - x * x * y * y * y) <= 0.02;
      } else {
        ok = true;
      }
      mask[r][c] = ok;
    }
  }
  // ensure at least some cells are playable
  if (!mask.some(row => row.some(Boolean))) return undefined;
  return mask;
}

export function isPlayable(state: Pick<GameState, 'rows' | 'cols' | 'mask'>, r: number, c: number): boolean {
  if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) return false;
  if (!state.mask) return true;
  return !!state.mask[r]?.[c];
}


export type TeamMode = 'off' | '2v2' | '3v3' | 'ffa';

export function normalizeTeamMode(value: unknown): Exclude<TeamMode, 'ffa'> {
  const v = String(value ?? 'off');
  if (v === '2v2' || v === '3v3') return v;
  return 'off';
}

export function isValidTeamModeForPlayers(mode: TeamMode, playerCount: number): boolean {
  if (mode === 'off') return true;
  if (mode === '2v2') return playerCount === 4;
  if (mode === '3v3') return playerCount === 6;
  return false;
}

export function createEmptyBoard(rows: number, cols: number, _mask?: boolean[][]): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ owner: null, count: 0 }))
  );
}

export function createGame(
  players: { name: string }[],
  rows?: number,
  cols?: number,
  opts?: { shape?: BoardShape; gameTimeMinutes?: unknown; maxPlayers?: number; teamMode?: 'off' | '2v2' | '3v3' | 'ffa' }
): GameState {
  const maxPlayers = Math.max(2, Math.min(8, Math.floor(Number(opts?.maxPlayers ?? 8) || 8)));
  const ps = players.slice(0, maxPlayers);
  let size = rows && cols ? { rows, cols } : recommendedBoardSize(ps.length || 2);
  const shape = normalizeBoardShape(opts?.shape);
  if (shape === 'square') {
    const n = Math.max(size.rows, size.cols);
    size = { rows: n, cols: n };
  }
  const mask = createBoardMask(size.rows, size.cols, shape);
  const gameTimeMinutes = normalizeGameTimeMinutes(opts?.gameTimeMinutes ?? 10);
  const gameDurationMs = gameDurationMsFor(gameTimeMinutes);
  const turnDurationMs = FIXED_TURN_MS;
  let teamMode = normalizeTeamMode(opts?.teamMode || 'off');
  if ((opts?.teamMode as any) === 'ffa') teamMode = 'off';
  // Preserve intended team mode for lobby/configuration state; server start validates required player count.
  const teamModeActive = teamMode === '2v2' || teamMode === '3v3';
  const teamsCount = teamModeActive ? 2 : 0;
  const assignTeam = (i: number) => {
    if (teamMode === '2v2') return i % 2; // 0,2 vs 1,3 (interleaved teams)
    if (teamMode === '3v3') return i % 2; // 0,2,4 vs 1,3,5
    return undefined;
  };
  const state: GameState = {
    rows: size.rows,
    cols: size.cols,
    board: createEmptyBoard(size.rows, size.cols, mask),
    players: ps.map((p, i) => ({
      id: i,
      name: p.name,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      alive: true,
      hasPlayed: false,
      ...(teamModeActive ? { team: assignTeam(i) } : {}),
    })),
    currentPlayerIndex: 0,
    status: ps.length >= 2 ? 'playing' : 'waiting',
    winner: null,
    turnCount: 0,
    maxPlayers,
    shape,
    ...(mask ? { mask } : {}),
    gameTimeMinutes,
    gameDurationMs,
    gameDeadline: null,
    turnDurationMs,
    turnDeadline: null,
    teamMode: teamModeActive ? teamMode : 'off',
    ...(teamsCount ? { teamsCount } : {}),
  };
  // randomize first turn at game start (color cycle toss target)
  if (state.status === 'playing' && state.players.length > 0) {
    state.currentPlayerIndex = Math.floor(Math.random() * state.players.length);
  }
  return state;
}

export function criticalMass(rows: number, cols: number, r: number, c: number, mask?: boolean[][]): number {
  let neighbors = 0;
  const playable = (rr: number, cc: number) => rr >= 0 && rr < rows && cc >= 0 && cc < cols && (!mask || !!mask[rr]?.[cc]);
  if (playable(r - 1, c)) neighbors++;
  if (playable(r + 1, c)) neighbors++;
  if (playable(r, c - 1)) neighbors++;
  if (playable(r, c + 1)) neighbors++;
  return Math.max(1, neighbors);
}

function cloneBoard(board: Cell[][]): Cell[][] {
  return board.map((row) => row.map((cell) => ({ ...cell })));
}

export interface ExplosionStep {
  r: number;
  c: number;
  owner: PlayerId;
}

export interface MoveResult {
  ok: boolean;
  error?: string;
  state?: GameState;
  explosions?: ExplosionStep[]; // ordered explosion events
}

export function orbCountsByPlayer(state: GameState): number[] {
  const counts = state.players.map(() => 0);
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (!isPlayable(state, r, c)) continue;
      const cell = state.board[r][c];
      if (cell.owner != null) counts[cell.owner] += cell.count;
    }
  }
  return counts;
}

export function getValidMoves(state: GameState, playerId: PlayerId): { r: number; c: number }[] {
  if (state.status !== 'playing') return [];
  if (isGameTimeExpired(state)) return [];
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return [];
  const player = state.players[idx];
  if (!player.alive) return [];
  if (state.currentPlayerIndex !== idx) return [];
  const moves: { r: number; c: number }[] = [];
  if (!player.hasPlayed) {
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        if (!isPlayable(state, r, c)) continue;
        if (state.board[r][c].owner === null) moves.push({ r, c });
      }
    }
  } else {
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        if (!isPlayable(state, r, c)) continue;
        if (state.board[r][c].owner === playerId) moves.push({ r, c });
      }
    }
  }
  return moves;
}

export function removePlayerCells(state: GameState, playerId: PlayerId): GameState {
  const playerIdx = state.players.findIndex((p) => p.id === playerId);
  if (playerIdx < 0) return state;

  const board = cloneBoard(state.board);
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (!isPlayable(state, r, c)) continue;
      if (board[r][c].owner === playerId) {
        board[r][c] = { owner: null, count: 0 };
      }
    }
  }

  // Treat removed/leaving players as out of active play; mark hasPlayed so they don't block progression.
  const players = state.players.map((p) => (p.id === playerId ? { ...p, alive: false, hasPlayed: true } : { ...p }));
  const nextState: GameState = {
    ...state,
    board,
    players,
  };

  if (nextState.status !== 'playing') return nextState;

  const everyonePlayed = allHavePlayed(nextState.players);
  if (everyonePlayed) {
    const counts = orbCountsByPlayer(nextState);
    for (let i = 0; i < nextState.players.length; i++) {
      if (nextState.players[i].alive && counts[i] === 0) {
        nextState.players[i].alive = false;
      }
    }
  }

  const alivePlayers = nextState.players.filter((p) => p.alive);
  const teamModeOn = nextState.teamMode && nextState.teamMode !== 'off' && nextState.teamMode !== 'ffa';
  if (teamModeOn) {
    const teamsAlive = aliveTeamIds(nextState);
    if (teamsAlive.length <= 1) {
      nextState.status = 'finished';
      if (teamsAlive.length === 1) {
        const rep = alivePlayers.find(p => p.team === teamsAlive[0]) || alivePlayers[0] || null;
        nextState.winner = rep ? rep.id : null;
      } else {
        nextState.winner = null;
      }
    } else {
      const cur = nextState.players[nextState.currentPlayerIndex];
      if (!cur || !cur.alive) {
        nextState.currentPlayerIndex = nextAliveIndex(nextState, nextState.currentPlayerIndex);
      }
    }
  } else if (everyonePlayed && alivePlayers.length <= 1) {
    nextState.status = 'finished';
    nextState.winner = alivePlayers.length === 1 ? alivePlayers[0].id : null;
  } else {
    // If only one (or zero) remains even before everyone has "played" in normal flow,
    // end the game so removed/opponent-gone states don't hang.
    if (alivePlayers.length <= 1) {
      nextState.status = 'finished';
      nextState.winner = alivePlayers.length === 1 ? alivePlayers[0].id : null;
    } else {
      const cur = nextState.players[nextState.currentPlayerIndex];
      if (!cur || !cur.alive) {
        nextState.currentPlayerIndex = nextAliveIndex(nextState, nextState.currentPlayerIndex);
      }
    }
  }
  return nextState;
}

function allHavePlayed(players: PlayerState[]): boolean {
  return players.every((p) => p.hasPlayed);
}



function aliveTeamIds(state: GameState): number[] {
  if (!state.teamMode || state.teamMode === 'off' || state.teamMode === 'ffa') return [];
  const set = new Set<number>();
  for (const p of state.players) {
    if (p.alive && typeof p.team === 'number') set.add(p.team);
  }
  return Array.from(set);
}

function nextAliveIndex(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    if (state.players[idx].alive) return idx;
  }
  return fromIndex;
}

export function isGameTimeExpired(state: GameState, now = Date.now()): boolean {
  return state.status === 'playing' && typeof state.gameDeadline === 'number' && now >= state.gameDeadline;
}

export function applyMove(state: GameState, playerId: PlayerId, r: number, c: number): MoveResult {
  if (state.status !== 'playing') return { ok: false, error: 'Game is not in progress' };
  if (isGameTimeExpired(state)) {
    return { ok: false, error: 'Game time expired', state: finishGameByTime(state) };
  }
  if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) return { ok: false, error: 'Out of bounds' };
  if (!isPlayable(state, r, c)) return { ok: false, error: 'Cell not available' };
  const current = state.players[state.currentPlayerIndex];
  if (!current || current.id !== playerId) return { ok: false, error: 'Not your turn' };
  if (!current.alive) return { ok: false, error: 'Player eliminated' };
  const cell = state.board[r][c];
  if (!current.hasPlayed) {
    if (cell.owner !== null) return { ok: false, error: 'Choose an empty cell for your first move' };
  } else {
    if (cell.owner !== playerId) return { ok: false, error: 'You can only increment your own cells' };
  }

  const board = cloneBoard(state.board);
  const players = state.players.map((p) => ({ ...p }));
  const explosions: ExplosionStep[] = [];
  const isFirstPlacement = !current.hasPlayed;
  const friendlyFireProtected = state.teamMode === '2v2' || state.teamMode === '3v3';
  const teamById = new Map<PlayerId, number | undefined>();
  if (friendlyFireProtected) {
    for (const p of players) teamById.set(p.id, p.team);
  }

  // First move on an empty cell starts with 3 dots everywhere.
  const nextCount = isFirstPlacement ? 3 : cell.count + 1;
  board[r][c] = { owner: playerId, count: nextCount };
  players[state.currentPlayerIndex].hasPlayed = true;

  // resolve chain reactions
  const queue: [number, number][] = [];
  const critical = criticalMass(state.rows, state.cols, r, c, state.mask);
  if (board[r][c].count >= critical) {
    queue.push([r, c]);
  }

  // resolve chain reactions with a safety cap to avoid hangs in degenerate cases
  let steps = 0;
  const softCap = state.rows * state.cols * 300;
  const hardCap = state.rows * state.cols * 1200;
  const enqueueIfUnstable = (rr: number, rc: number) => {
    const c = board[rr][rc];
    if (c.owner == null) return;
    if (c.count >= criticalMass(state.rows, state.cols, rr, rc, state.mask)) queue.push([rr, rc]);
  };
  while (queue.length > 0 && steps < hardCap) {
    const [cr, cc] = queue.shift()!;
    const crit = criticalMass(state.rows, state.cols, cr, cc, state.mask);
    const cellNow = board[cr][cc];
    if (cellNow.owner == null || cellNow.count < crit) continue;
    const owner = cellNow.owner;

    // explode
    board[cr][cc].count -= crit;
    if (board[cr][cc].count === 0) board[cr][cc].owner = null;
    // The explosion log is an animation hint; cap its size for pathological cascades
    // while still resolving the authoritative board below.
    if (steps < softCap) explosions.push({ r: cr, c: cc, owner });
    steps++;

    const dirs = [
      [cr - 1, cc],
      [cr + 1, cc],
      [cr, cc - 1],
      [cr, cc + 1],
    ] as const;
    for (const [nr, nc] of dirs) {
      if (nr < 0 || nr >= state.rows || nc < 0 || nc >= state.cols) continue;
      if (!isPlayable(state, nr, nc)) continue;
      const target = board[nr][nc];
      let nextOwner = owner;
      if (friendlyFireProtected && target.owner != null && target.owner !== owner) {
        const oTeam = teamById.get(owner);
        const tTeam = teamById.get(target.owner);
        if (oTeam != null && tTeam != null && oTeam === tTeam) {
          nextOwner = target.owner; // friendly fire protection: feed teammate instead of capturing
        }
      }
      board[nr][nc] = { owner: nextOwner, count: target.count + 1 };
      if (board[nr][nc].count >= criticalMass(state.rows, state.cols, nr, nc, state.mask)) {
        queue.push([nr, nc]);
      }
    }
    // if this cell is still unstable (can happen in high-count edge cases), requeue
    enqueueIfUnstable(cr, cc);
  }
  // Best-effort final sweep if cap reached but state still unstable (extremely rare): clamp to just-below-critical
  if (queue.length > 0 || steps >= hardCap) {
    for (let rr = 0; rr < state.rows; rr++) {
      for (let rc = 0; rc < state.cols; rc++) {
        if (!isPlayable(state, rr, rc)) continue;
        const crit = criticalMass(state.rows, state.cols, rr, rc, state.mask);
        if (board[rr][rc].owner != null && board[rr][rc].count >= crit) {
          board[rr][rc].count = Math.max(0, crit - 1);
        }
      }
    }
  }

  const nextState: GameState = {
    ...state,
    board,
    players,
    turnCount: state.turnCount + 1,
  };

  // update eliminations after everyone has played once
  const everyonePlayed = allHavePlayed(nextState.players);
  if (!everyonePlayed) {
    // Opening-round protection: do not eliminate players before everyone has taken their first turn.
    // This prevents a big early chain reaction from knocking someone out before they get to play.
    for (const p of nextState.players) {
      if (!p.hasPlayed) p.alive = true;
    }
    nextState.currentPlayerIndex = nextAliveIndex(nextState, state.currentPlayerIndex);
    return { ok: true, state: nextState, explosions };
  }

  if (everyonePlayed) {
    const counts = orbCountsByPlayer(nextState);
    for (let i = 0; i < nextState.players.length; i++) {
      if (nextState.players[i].alive && counts[i] === 0) {
        nextState.players[i].alive = false;
      }
    }
  }

  // check winner
  const alivePlayers = nextState.players.filter((p) => p.alive);
  const teamModeOn = nextState.teamMode && nextState.teamMode !== 'off' && nextState.teamMode !== 'ffa';
  if (everyonePlayed && teamModeOn) {
    const teamsAlive = aliveTeamIds(nextState);
    if (teamsAlive.length === 1) {
      nextState.status = 'finished';
      // represent winning team by id of any alive member on that team (UI can interpret team winner)
      const winTeam = teamsAlive[0];
      const rep = alivePlayers.find(p => p.team === winTeam) || alivePlayers[0];
      nextState.winner = rep ? rep.id : playerId;
    } else if (teamsAlive.length === 0) {
      nextState.status = 'finished';
      nextState.winner = playerId;
    } else {
      nextState.currentPlayerIndex = nextAliveIndex(nextState, state.currentPlayerIndex);
    }
  } else if (everyonePlayed && alivePlayers.length === 1) {
    nextState.status = 'finished';
    nextState.winner = alivePlayers[0].id;
  } else if (everyonePlayed && alivePlayers.length === 0) {
    // rare: simultaneous elimination, last mover wins
    nextState.status = 'finished';
    nextState.winner = playerId;
  } else {
    nextState.currentPlayerIndex = nextAliveIndex(nextState, state.currentPlayerIndex);
  }

  return { ok: true, state: nextState, explosions };
}
