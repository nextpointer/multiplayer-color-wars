import { SLOTS, type XY } from "./geometry";

function dist2(a: XY, b: XY) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function permute<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permute(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

// injective assignments: map each of the `k` existing dots to one of `n` target slots (k <= n)
function injectiveAssignments(k: number, n: number): number[][] {
  const idx = Array.from({ length: n }, (_, i) => i);
  // choose permutations of all n but we only care about mapping dots 0..k-1 to first k of perm? simpler: permutations of target indices taken k at a time
  // generate all k-length sequences of distinct indices from 0..n-1
  const results: number[][] = [];
  function backtrack(path: number[], used: boolean[]) {
    if (path.length === k) { results.push([...path]); return; }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true; path.push(i);
      backtrack(path, used);
      path.pop(); used[i] = false;
    }
  }
  backtrack([], Array(n).fill(false));
  return results;
}

export function assignSlots(oldCount: 1 | 2 | 3 | 4, newCount: 1 | 2 | 3 | 4, currentPos: XY[]): {
  existing: { dotIndex: number; to: XY }[];
  arriving: XY;
} {
  const targets = SLOTS[newCount];
  if (oldCount === 0 as any) {
    return { existing: [], arriving: targets[0] };
  }
  let best: number[] = [];
  let bestCost = Infinity;
  for (const assignment of injectiveAssignments(oldCount, targets.length)) {
    // assignment[dotIndex] = targetSlotIndex
    const cost = assignment.reduce((s, slotIdx, dot) => s + dist2(currentPos[dot] || {x:0,y:0}, targets[slotIdx]), 0);
    if (cost < bestCost) { bestCost = cost; best = assignment; }
  }
  const used = new Set(best);
  let free = targets.findIndex((_, i) => !used.has(i));
  if (free < 0) free = targets.length - 1;
  return {
    existing: best.map((slotIdx, dot) => ({ dotIndex: dot, to: targets[slotIdx] })),
    arriving: targets[free],
  };
}

// simple self-check: adjacent slot center distances >= dot diameter (0.13 * cell units? slots in fractions of cell)
export function slotsValid(): boolean {
  const diam = 0.13;
  for (const k of [1,2,3,4] as const) {
    const s = SLOTS[k];
    for (let i=0;i<s.length;i++) for (let j=i+1;j<s.length;j++) {
      const d = Math.sqrt(dist2(s[i], s[j]));
      if (d + 1e-9 < diam) return false;
    }
  }
  return true;
}
