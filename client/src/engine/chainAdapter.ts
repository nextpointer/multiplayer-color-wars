import { criticalMass, type Cell, type PlayerId } from "@game/shared";

export type Dir = "N" | "S" | "W" | "E";

export interface FlightTarget {
  tr: number;
  tc: number;
  dir: Dir;
  captureOwner: PlayerId;
  targetCountAfter: number;
}

export interface BurstEvent {
  id: string;
  wave: number;
  seq: number;
  r: number;
  c: number;
  owner: PlayerId;
  crit: number;
  targets: FlightTarget[];
}

export interface MoveAnimationPlan {
  move: { r: number; c: number; playerId: PlayerId };
  placement: { r: number; c: number; countAfter: number } | null;
  waves: BurstEvent[][];
  totalBursts: number;
}

function cloneBoard(board: Cell[][]): Cell[][] {
  return board.map(row => row.map(cell => ({ owner: cell.owner, count: cell.count })));
}

const DIRS: { dr: number; dc: number; dir: Dir }[] = [
  { dr: -1, dc: 0, dir: "N" },
  { dr: 1, dc: 0, dir: "S" },
  { dr: 0, dc: -1, dir: "W" },
  { dr: 0, dc: 1, dir: "E" },
];

export function deriveMovePlan(args: {
  rows: number;
  cols: number;
  preBoard: Cell[][];
  playerId: PlayerId;
  r: number;
  c: number;
  explosions: { r: number; c: number; owner: PlayerId }[];
}): MoveAnimationPlan {
  const { rows, cols, preBoard, playerId, r, c, explosions } = args;
  const sim = cloneBoard(preBoard);
  const waves: BurstEvent[][] = [];
  let cursor = 0;
  let seq = 0;

  // placement (custom rule: cells start with 3 dots, increment count)
  const baseCount = sim[r][c].count === 0 ? 2 : sim[r][c].count;
  sim[r][c] = { owner: playerId, count: baseCount + 1 };
  const placement = { r, c, countAfter: sim[r][c].count };
  const queue: [number, number][] = [];
  if (sim[r][c].count >= criticalMass(rows, cols, r, c)) {
    queue.push([r, c]);
  }

  let waveIndex = 0;
  const stepsCap = rows * cols * 400;
  let guard = 0;
  while (queue.length > 0 && cursor < explosions.length + 5 && guard < stepsCap) {
    guard++;
    const levelSize = queue.length;
    const level: BurstEvent[] = [];
    const nextQueue: [number, number][] = [];
    // process current level in FIFO order matching applyMove's shift behavior
    const work = queue.splice(0, levelSize);
    for (let i = 0; i < work.length; i++) {
      const [cr, cc] = work[i];
      const crit = criticalMass(rows, cols, cr, cc);
      if (sim[cr][cc].count < crit) continue; // stale
      const owner = sim[cr][cc].owner;
      if (owner == null) continue;
      const exp = explosions[cursor];
      // dev-align if possible
      if (exp && (exp.r !== cr || exp.c !== cc || exp.owner !== owner)) {
        // mismatch: best effort - continue but try to stay in sync by not consuming cursor wrongly
        // fall through to consume in order; logic below mirrors applyMove so should match
      }
      sim[cr][cc].count -= crit;
      if (sim[cr][cc].count === 0) sim[cr][cc].owner = null;
      if (exp) cursor++;

      const targets: FlightTarget[] = [];
      for (const d of DIRS) {
        const nr = cr + d.dr;
        const nc = cc + d.dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        sim[nr][nc] = { owner, count: sim[nr][nc].count + 1 };
        targets.push({ tr: nr, tc: nc, dir: d.dir, captureOwner: owner, targetCountAfter: sim[nr][nc].count });
        if (sim[nr][nc].count >= criticalMass(rows, cols, nr, nc)) {
          nextQueue.push([nr, nc]);
        }
      }
      level.push({ id: `w${waveIndex}-${cr}-${cc}-${seq}`, wave: waveIndex, seq, r: cr, c: cc, owner, crit, targets });
      seq++;
    }
    if (level.length) waves.push(level);
    // enqueue next level at end (BFS) - but we must preserve FIFO across levels exactly as applyMove:
    // applyMove pushes to same queue tail while consuming head; processing in level batches of original size gives same order.
    queue.push(...nextQueue);
    waveIndex++;
    if (waves.length > 500) break;
  }

  return { move: { r, c, playerId }, placement, waves, totalBursts: seq };
}

export function emptyPlan(): MoveAnimationPlan {
  return { move: { r: -1, c: -1, playerId: -1 }, placement: null, waves: [], totalBursts: 0 };
}

/**
 * Pre-compute board snapshots for playback:
 * [0] board right after the placement (pre-burst)
 * [k] board after wave k's arrivals have been committed (k = 1..waves.length)
 * Snapshot k-1 also lets the player know which cells burst at wave k
 * (from the wave's BurstEvents).
 */
export function precomputeSnapshots(preBoard: Cell[][], plan: MoveAnimationPlan): Cell[][][] {
  const board = cloneBoard(preBoard);
  const snapshots: Cell[][][] = [];
  if (plan.placement) {
    board[plan.placement.r][plan.placement.c] = {
      owner: plan.move.playerId,
      count: plan.placement.countAfter,
    };
  }
  snapshots.push(cloneBoard(board));

  for (const wave of plan.waves) {
    // commit wave: remove bursting cells, add to targets
    for (const ev of wave) {
      const cell = board[ev.r][ev.c];
      cell.count -= ev.crit;
      if (cell.count <= 0) { cell.count = 0; cell.owner = null; }
    }
    for (const ev of wave) {
      for (const t of ev.targets) {
        const tc = board[t.tr][t.tc];
        tc.owner = t.captureOwner;
        tc.count = t.targetCountAfter;
      }
    }
    snapshots.push(cloneBoard(board));
  }
  return snapshots;
}
