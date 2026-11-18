import { applyMove, criticalMass, getValidMoves, orbCountsByPlayer, type GameState, type PlayerId } from "@game/shared";

export type BotDifficulty = "easy" | "medium" | "hard";

export interface BotMove {
  r: number;
  c: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isCorner(r: number, c: number, rows: number, cols: number) {
  return (r === 0 || r === rows - 1) && (c === 0 || c === cols - 1);
}
function isEdge(r: number, c: number, rows: number, cols: number) {
  return r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
}

function cellStrategicValue(r: number, c: number, state: GameState): number {
  const crit = criticalMass(state.rows, state.cols, r, c);
  // lower critical mass (corners=2, edges=3, center=4) is generally safer/stronger to hold
  let v = (4 - crit) * 6;
  if (isCorner(r, c, state.rows, state.cols)) v += 8;
  else if (isEdge(r, c, state.rows, state.cols)) v += 3;
  return v;
}

function evaluateState(state: GameState, botId: PlayerId): number {
  const botIdx = state.players.findIndex(p => p.id === botId);
  if (botIdx < 0) return -1e9;
  const bot = state.players[botIdx];
  const opponents = state.players.filter(p => p.id !== botId);
  const aliveOpp = opponents.filter(p => p.alive);

  if (state.status === "finished") {
    if (state.winner === botId) return 1_000_000;
    if (state.winner == null) return 0;
    return -1_000_000;
  }
  if (!bot.alive) return -900_000;
  if (aliveOpp.length === 0) return 900_000;

  const orbCounts = orbCountsByPlayer(state);
  const botOrbs = orbCounts[botIdx] ?? 0;
  let oppOrbs = 0;
  let oppCells = 0;
  let botCells = 0;
  let score = 0;

  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p.id === botId) continue;
    if (p.alive) oppOrbs += orbCounts[i] ?? 0;
  }

  // board features
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.board[r][c];
      if (cell.owner == null) continue;
      const crit = criticalMass(state.rows, state.cols, r, c);
      const danger = Math.max(0, crit - cell.count); // 1 means ready to explode
      const basePos = cellStrategicValue(r, c, state);
      const nearCritBonus = danger === 1 ? 10 : danger === 2 ? 4 : 1;

      if (cell.owner === botId) {
        botCells++;
        score += basePos;
        score += cell.count * 2;
        score += nearCritBonus;
      } else {
        oppCells++;
        score -= basePos * 0.9;
        score -= cell.count * 1.8;
        // opponent cell about to explode can be good if we can trigger, but risky if they can; slight penalty
        if (danger === 1) score -= 6;
      }
    }
  }

  score += (botOrbs - oppOrbs) * 3.5;
  score += (botCells - oppCells) * 12;
  score += bot.alive ? 20 : -1000;
  score -= aliveOpp.length * 8;

  // mobility / having moves
  const myMoves = getValidMoves(state, botId).length;
  score += Math.min(20, myMoves) * 0.5;
  if (myMoves === 0 && bot.alive) score -= 200;

  // opening: encourage taking good empty spots
  if (!bot.hasPlayed) {
    // no extra, candidate ordering handles it
  }

  return score;
}

function moveOrderKey(move: BotMove, state: GameState, playerId: PlayerId): number {
  let k = 0;
  const cell = state.board[move.r][move.c];
  const crit = criticalMass(state.rows, state.cols, move.r, move.c);
  if (cell.owner === playerId) {
    // adding to own cell: prefer near-critical and strategic
    const danger = crit - cell.count;
    if (danger <= 1) k += 100;
    else if (danger === 2) k += 40;
    k += cellStrategicValue(move.r, move.c, state);
  } else if (cell.owner == null) {
    // first move: corners/edges best
    k += cellStrategicValue(move.r, move.c, state) + 20;
  } else {
    // shouldn't happen for valid moves, but safe
    k += 10;
  }
  return k;
}

function orderedMoves(state: GameState, playerId: PlayerId, limit?: number): BotMove[] {
  const moves = getValidMoves(state, playerId);
  if (moves.length === 0) return [];
  let ordered = moves
    .map(m => ({ m, k: moveOrderKey(m, state, playerId) + Math.random() * 0.01 }))
    .sort((a, b) => b.k - a.k)
    .map(x => x.m);

  // opening pruning: too many empty cells, keep strategic subset for search speed
  const player = state.players.find(p => p.id === playerId);
  if (player && !player.hasPlayed && ordered.length > 20) {
    const corners = ordered.filter(m => isCorner(m.r, m.c, state.rows, state.cols));
    const edges = ordered.filter(m => !isCorner(m.r, m.c, state.rows, state.cols) && isEdge(m.r, m.c, state.rows, state.cols));
    const rest = ordered.filter(m => !isEdge(m.r, m.c, state.rows, state.cols));
    const picked: BotMove[] = [];
    const seen = new Set<string>();
    const add = (m: BotMove) => { const k = `${m.r},${m.c}`; if (!seen.has(k)) { seen.add(k); picked.push(m); } };
    for (const m of corners) add(m);
    for (const m of shuffle(edges).slice(0, 12)) add(m);
    for (const m of shuffle(rest).slice(0, 8)) add(m);
    ordered = picked.length ? picked : ordered.slice(0, 16);
  }

  if (limit != null && ordered.length > limit) ordered = ordered.slice(0, limit);
  return ordered;
}

function simulate(state: GameState, playerId: PlayerId, move: BotMove): GameState | null {
  const res = applyMove(state, playerId, move.r, move.c);
  if (!res.ok || !res.state) return null;
  return res.state;
}

function currentPlayerId(state: GameState): PlayerId | null {
  const p = state.players[state.currentPlayerIndex];
  return p && p.alive ? p.id : null;
}

function negamax(state: GameState, perspectiveId: PlayerId, depth: number, alpha: number, beta: number): number {
  if (depth <= 0 || state.status !== "playing") {
    return evaluateState(state, perspectiveId);
  }
  const pid = currentPlayerId(state);
  if (pid == null) return evaluateState(state, perspectiveId);

  const sign = pid === perspectiveId ? 1 : -1;
  const moves = orderedMoves(state, pid, depth >= 3 ? 10 : depth >= 2 ? 14 : 18);
  if (moves.length === 0) return evaluateState(state, perspectiveId);

  let best = -Infinity;
  for (const move of moves) {
    const next = simulate(state, pid, move);
    if (!next) continue;
    let val: number;
    if (next.status === "finished") {
      val = evaluateState(next, perspectiveId) * sign; // from side-to-move perspective
    } else {
      // if next player is same perspective side in multi? 2-player alternates
      const child = negamax(next, perspectiveId, depth - 1, -beta, -alpha);
      const nextPid = currentPlayerId(next);
      // convert child (perspective absolute via recursion style below?) easier: use standard negamax on "value for side to move"
      val = nextPid === pid ? child : -child;
    }
    // but above mixing is messy; easier to use minimax absolute. fallback: minimax style below
    best = Math.max(best, val);
    alpha = Math.max(alpha, val);
    if (alpha >= beta) break;
  }
  return best === -Infinity ? sign * evaluateState(state, perspectiveId) : best;
}

// Absolute minimax (simpler/correct for N players reduced to bot vs others)
function minimax(state: GameState, botId: PlayerId, depth: number, alpha: number, beta: number): number {
  if (depth <= 0 || state.status !== "playing") return evaluateState(state, botId);
  const pid = currentPlayerId(state);
  if (pid == null) return evaluateState(state, botId);
  const maximizing = pid === botId;
  const moveLimit = depth >= 3 ? 10 : depth >= 2 ? 14 : 18;
  const moves = orderedMoves(state, pid, moveLimit);
  if (moves.length === 0) return evaluateState(state, botId);

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      const next = simulate(state, pid, move);
      if (!next) continue;
      const val = minimax(next, botId, depth - 1, alpha, beta);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      const next = simulate(state, pid, move);
      if (!next) continue;
      const val = minimax(next, botId, depth - 1, alpha, beta);
      if (val < best) best = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return best;
  }
}

function pickBestByEval(state: GameState, botId: PlayerId, difficulty: BotDifficulty): BotMove | null {
  const moves = getValidMoves(state, botId);
  if (moves.length === 0) return null;

  if (difficulty === "easy") {
    // mostly random, slight preference for decent opening spots
    const ordered = orderedMoves(state, botId);
    const top = ordered.slice(0, Math.min(ordered.length, 8));
    const pool = Math.random() < 0.65 ? (top.length ? top : ordered) : ordered;
    return pool[Math.floor(Math.random() * pool.length)] || null;
  }

  if (difficulty === "medium") {
    const candidates = orderedMoves(state, botId, 24);
    let bestScore = -Infinity;
    let best: BotMove[] = [];
    for (const move of candidates) {
      const next = simulate(state, botId, move);
      if (!next) continue;
      // immediate win
      if (next.status === "finished" && next.winner === botId) return move;
      let s = evaluateState(next, botId);
      // tiny look at opponent replies for obviously bad moves
      const oppId = currentPlayerId(next);
      if (oppId != null && oppId !== botId && next.status === "playing") {
        const replies = orderedMoves(next, oppId, 8);
        let worstForBot = Infinity;
        if (replies.length === 0) worstForBot = s;
        for (const r of replies.slice(0, 6)) {
          const after = simulate(next, oppId, r);
          if (!after) continue;
          const es = evaluateState(after, botId);
          if (es < worstForBot) worstForBot = es;
        }
        if (worstForBot !== Infinity) s = s * 0.7 + worstForBot * 0.3;
      }
      s += Math.random() * 0.5; // small jitter
      if (s > bestScore + 1e-9) { bestScore = s; best = [move]; }
      else if (Math.abs(s - bestScore) <= 1e-9) best.push(move);
    }
    return best[Math.floor(Math.random() * best.length)] || candidates[0] || null;
  }

  // hard
  const candidates = orderedMoves(state, botId, 20);
  // immediate win
  for (const move of candidates) {
    const next = simulate(state, botId, move);
    if (next && next.status === "finished" && next.winner === botId) return move;
  }

  const totalCells = state.rows * state.cols;
  const empties = getValidMoves(state, botId).length;
  const depth = !state.players.find(p => p.id === botId)?.hasPlayed && empties > 12 ? 2 : (empties > 18 ? 2 : 3);
  let bestScore = -Infinity;
  let best: BotMove[] = [];
  for (const move of candidates) {
    const next = simulate(state, botId, move);
    if (!next) continue;
    let s = minimax(next, botId, depth - 1, -Infinity, Infinity);
    s += Math.random() * 0.35;
    // slight preference for strategic opening placements
    if (!state.players.find(p => p.id === botId)?.hasPlayed) s += cellStrategicValue(move.r, move.c, state) * 0.2;
    if (s > bestScore + 1e-9) { bestScore = s; best = [move]; }
    else if (Math.abs(s - bestScore) <= 1e-9) best.push(move);
  }
  return best[Math.floor(Math.random() * best.length)] || candidates[0] || null;
}

export function chooseBotMove(state: GameState, botId: PlayerId, difficulty: BotDifficulty): BotMove | null {
  if (state.status !== "playing") return null;
  const cur = state.players[state.currentPlayerIndex];
  if (!cur || cur.id !== botId || !cur.alive) return null;
  return pickBestByEval(state, botId, difficulty);
}
