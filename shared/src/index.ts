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
}

export type GameStatus = 'waiting' | 'playing' | 'finished';

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

export function createEmptyBoard(rows: number, cols: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ owner: null, count: 0 }))
  );
}

export function createGame(
  players: { name: string }[],
  rows?: number,
  cols?: number
): GameState {
  const maxPlayers = 8;
  const ps = players.slice(0, maxPlayers);
  const size = rows && cols ? { rows, cols } : recommendedBoardSize(ps.length || 2);
  return {
    rows: size.rows,
    cols: size.cols,
    board: createEmptyBoard(size.rows, size.cols),
    players: ps.map((p, i) => ({
      id: i,
      name: p.name,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      alive: true,
      hasPlayed: false,
    })),
    currentPlayerIndex: 0,
    status: ps.length >= 2 ? 'playing' : 'waiting',
    winner: null,
    turnCount: 0,
    maxPlayers,
  };
}

export function criticalMass(rows: number, cols: number, r: number, c: number): number {
  let neighbors = 0;
  if (r > 0) neighbors++;
  if (r < rows - 1) neighbors++;
  if (c > 0) neighbors++;
  if (c < cols - 1) neighbors++;
  return neighbors;
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
      const cell = state.board[r][c];
      if (cell.owner != null) counts[cell.owner] += cell.count;
    }
  }
  return counts;
}

export function getValidMoves(state: GameState, playerId: PlayerId): { r: number; c: number }[] {
  if (state.status !== 'playing') return [];
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return [];
  const player = state.players[idx];
  if (!player.alive) return [];
  if (state.currentPlayerIndex !== idx) return [];
  const moves: { r: number; c: number }[] = [];
  if (!player.hasPlayed) {
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        if (state.board[r][c].owner === null) moves.push({ r, c });
      }
    }
  } else {
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
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
  if (everyonePlayed && alivePlayers.length <= 1) {
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

function nextAliveIndex(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    if (state.players[idx].alive) return idx;
  }
  return fromIndex;
}

export function applyMove(state: GameState, playerId: PlayerId, r: number, c: number): MoveResult {
  if (state.status !== 'playing') return { ok: false, error: 'Game is not in progress' };
  if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) return { ok: false, error: 'Out of bounds' };
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

  // first move: place a new cell with 3 dots; afterwards: increment own cell
  const nextCount = cell.count === 0 ? 3 : cell.count + 1;
  board[r][c] = { owner: playerId, count: nextCount };
  players[state.currentPlayerIndex].hasPlayed = true;

  // resolve chain reactions
  const queue: [number, number][] = [];
  if (board[r][c].count >= criticalMass(state.rows, state.cols, r, c)) {
    queue.push([r, c]);
  }

  // safety cap to avoid infinite loops in degenerate cases
  let steps = 0;
  const maxSteps = state.rows * state.cols * 200;
  while (queue.length > 0 && steps < maxSteps) {
    const [cr, cc] = queue.shift()!;
    const crit = criticalMass(state.rows, state.cols, cr, cc);
    if (board[cr][cc].count < crit) continue;
    const owner = board[cr][cc].owner;
    if (owner == null) continue;

    // explode
    board[cr][cc].count -= crit;
    if (board[cr][cc].count === 0) board[cr][cc].owner = null;
    explosions.push({ r: cr, c: cc, owner });
    steps++;

    const dirs = [
      [cr - 1, cc],
      [cr + 1, cc],
      [cr, cc - 1],
      [cr, cc + 1],
    ] as const;
    for (const [nr, nc] of dirs) {
      if (nr < 0 || nr >= state.rows || nc < 0 || nc >= state.cols) continue;
      board[nr][nc] = { owner, count: board[nr][nc].count + 1 };
      if (board[nr][nc].count >= criticalMass(state.rows, state.cols, nr, nc)) {
        queue.push([nr, nc]);
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
  if (everyonePlayed && alivePlayers.length === 1) {
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
