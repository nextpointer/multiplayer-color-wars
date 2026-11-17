import React, { forwardRef, useImperativeHandle, useRef } from "react";
import type { MoveAnimationPlan, BurstEvent } from "./chainAdapter";
import { SPEED } from "../design/motion";
import { SLOTS, DOT_R_F } from "./geometry";

export interface SvgFlightEngineHandle {
  play: (plan: MoveAnimationPlan, opts: {
    metrics: { cell: number; gap: number; boardW: number; boardH: number };
    speed: "normal" | "fast";
    reduced: boolean;
    originColor: string;
    snapshots: CellLike[][][];
    playerColors: Record<number, string>;
    onWaveStart?: (wave: number, events: BurstEvent[]) => void;
    onWaveArrivals?: (wave: number, events: BurstEvent[]) => void;
    onCellFlash?: (r: number, c: number) => void;
    onDone?: () => void;
  }) => Promise<void>;
  isPlaying: () => boolean;
  clear: () => void;
}

type CellLike = { owner: number | null; count: number };

function centerOf(r: number, c: number, cell: number, gap: number) {
  return { x: c * (cell + gap) + cell / 2, y: r * (cell + gap) + cell / 2 };
}

const DIAMOND_SLOT_BY_DIR: Record<string, { x: number; y: number }> = {
  N: SLOTS[4][0],
  E: SLOTS[4][1],
  S: SLOTS[4][2],
  W: SLOTS[4][3],
};

const PIECE_R_F = 0.39;

function formationSlots(count: number) {
  const n = Math.max(0, Math.min(4, count));
  if (n === 0) return [];
  return SLOTS[n as 1 | 2 | 3 | 4];
}

export const SvgFlightEngine = forwardRef<SvgFlightEngineHandle, {}>(function SvgFlightEngine(_props, ref) {
  const layerRef = useRef<SVGGElement | null>(null);
  const fxRef = useRef<SVGGElement | null>(null);
  const playingRef = useRef(false);
  const runIdRef = useRef(0);

  const clear = () => {
    if (layerRef.current) layerRef.current.innerHTML = "";
    if (fxRef.current) fxRef.current.innerHTML = "";
    playingRef.current = false;
  };

  const addCellFlash = (cx: number, cy: number, cell: number) => {
    if (!fxRef.current) return;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(cx - cell / 2));
    rect.setAttribute("y", String(cy - cell / 2));
    rect.setAttribute("width", String(cell));
    rect.setAttribute("height", String(cell));
    rect.setAttribute("rx", String(cell * 0.24));
    rect.setAttribute("fill", "#FDF6E6");
    rect.setAttribute("opacity", "0.8");
    fxRef.current.appendChild(rect);
    const anim = rect.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 140, fill: "forwards" });
    anim.onfinish = () => rect.remove();
  };

  const addBurstRing = (cx: number, cy: number, cell: number, playerColor: string, reduced: boolean) => {
    if (!fxRef.current || reduced) return;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const r0 = PIECE_R_F * cell;
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(r0));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", playerColor);
    circle.setAttribute("stroke-width", "3");
    circle.setAttribute("opacity", "0.4");
    fxRef.current.appendChild(circle);
    const anim = circle.animate([{ opacity: 0.4 }, { opacity: 0 }], { duration: 220, easing: "ease-out", fill: "forwards" });
    anim.onfinish = () => circle.remove();
  };

  useImperativeHandle(ref, () => ({
    isPlaying: () => playingRef.current,
    clear,
    play: async (plan, opts) => {
      const myRun = ++runIdRef.current;
      playingRef.current = true;
      const { metrics, speed, reduced } = opts;
      const flightMs = SPEED[speed].hopTargetMs;
      const waveGap = SPEED[speed].waveGap;
      const dotR = Math.max(2, DOT_R_F * metrics.cell);
      try {
        if (!plan.waves.length) {
          opts.onDone?.();
          return;
        }
        for (let wi = 0; wi < plan.waves.length; wi++) {
          if (runIdRef.current !== myRun) return;
          const wave = plan.waves[wi];
          const preBoard = opts.snapshots[wi] || null; // board state before this wave's removals

          // pre-assign landing slots per target cell so dots land exactly at resting positions
          // postArrivals = snapshot[wi + 1] board
          const postBoard = opts.snapshots[wi + 1] || null;
          const slotAssign: Map<string, { x: number; y: number }[]> = new Map();
          if (postBoard) {
            // group by target cell
            const groups: Record<string, { ev: BurstEvent; ti: number }[]> = {};
            for (const ev of wave) {
              for (let ti = 0; ti < ev.targets.length; ti++) {
                const t = ev.targets[ti];
                const key = `${t.tr}:${t.tc}`;
                (groups[key] ||= []).push({ ev, ti });
              }
            }
            for (const [key, list] of Object.entries(groups)) {
              const [tr, tc] = key.split(":").map(Number);
              const finalCount = postBoard[tr][tc].count;
              const slots = formationSlots(finalCount);
              // reserve slots for arrivals: pick slots best-aligned to each flight's direction (greedy)
              const taken = new Set<number>();
              const assigned: ({ x: number; y: number } | null)[] = list.map(() => null);
              // order by alignment with direction
              for (let li = 0; li < list.length; li++) {
                const { ev, ti } = list[li];
                const t = ev.targets[ti];
                const dirVec = DIAMOND_SLOT_BY_DIR[t.dir] || { x: 0, y: 0 };
                let bestSlot = -1;
                let bestDot = -Infinity;
                for (let si = 0; si < slots.length; si++) {
                  if (taken.has(si)) continue;
                  const dot = slots[si].x * dirVec.x + slots[si].y * dirVec.y;
                  if (dot > bestDot) { bestDot = dot; bestSlot = si; }
                }
                if (bestSlot >= 0) { taken.add(bestSlot); assigned[li] = slots[bestSlot]; }
              }
              // fallback for unassigned (shouldn't happen)
              for (let li = 0; li < assigned.length; li++) {
                if (!assigned[li]) assigned[li] = slots[list.length - 1] || { x: 0, y: 0 };
              }
              slotAssign.set(key, assigned as { x: number; y: number }[]);
            }
          }

          opts.onWaveStart?.(wi, wave);

          for (const ev of wave) {
            const o = centerOf(ev.r, ev.c, metrics.cell, metrics.gap);
            addCellFlash(o.x, o.y, metrics.cell);
            addBurstRing(o.x, o.y, metrics.cell, opts.playerColors[ev.owner] || opts.originColor, reduced);
          }

          const donePromises: Promise<void>[] = [];
          let flightIdx = 0;
          for (let ei = 0; ei < wave.length; ei++) {
            const ev = wave[ei];
            const from = centerOf(ev.r, ev.c, metrics.cell, metrics.gap);
            const color = opts.playerColors[ev.owner] || opts.originColor;
            const delay = Math.min(ei * 24, 200);
            for (let ti = 0; ti < ev.targets.length; ti++) {
              const t = ev.targets[ti];
              const to = centerOf(t.tr, t.tc, metrics.cell, metrics.gap);
              if (!layerRef.current) continue;

              // landing slot (exact resting position in the target's formation)
              const key = `${t.tr}:${t.tc}`;
              const assignedList = slotAssign.get(key);
              const slot = assignedList ? assignedList[flightIdx] || { x: 0, y: 0 } : { x: 0, y: 0 };
              const landX = to.x + slot.x * metrics.cell;
              const landY = to.y + slot.y * metrics.cell;
              flightIdx++;

              if (reduced) {
                const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                const c1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                c1.setAttribute("cx", String(landX));
                c1.setAttribute("cy", String(landY));
                c1.setAttribute("r", String(dotR));
                c1.setAttribute("fill", "#fff");
                c1.setAttribute("opacity", "0");
                g.appendChild(c1);
                layerRef.current.appendChild(g);
                donePromises.push(new Promise<void>((res) => {
                  setTimeout(() => {
                    c1.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: "forwards" });
                    setTimeout(() => { g.remove(); res(); }, 140);
                  }, delay);
                }));
                continue;
              }

              // take-off position = the source's formation slot aligned with the flight direction
              const fromSlots = formationSlots(ev.crit);
              const dirVec = DIAMOND_SLOT_BY_DIR[t.dir] || { x: 0, y: 0 };
              let takeOff = fromSlots[fromSlots.length - 1] || { x: 0, y: 0 };
              if (ev.crit === 4) {
                takeOff = dirVec;
              } else {
                let best = 0;
                let bestDot = -Infinity;
                for (let si = 0; si < fromSlots.length; si++) {
                  const dot = fromSlots[si].x * dirVec.x + fromSlots[si].y * dirVec.y;
                  if (dot > bestDot) { bestDot = dot; best = si; }
                }
                takeOff = fromSlots[best];
              }
              const kick = { x: from.x + takeOff.x * metrics.cell, y: from.y + takeOff.y * metrics.cell };

              const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
              const halo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
              halo.setAttribute("cx", String(kick.x));
              halo.setAttribute("cy", String(kick.y));
              halo.setAttribute("r", String(dotR * 1.35));
              halo.setAttribute("fill", color);
              halo.setAttribute("opacity", "0.35");

              const ghost = document.createElementNS("http://www.w3.org/2000/svg", "circle");
              ghost.setAttribute("cx", String(kick.x));
              ghost.setAttribute("cy", String(kick.y));
              ghost.setAttribute("r", String(dotR));
              ghost.setAttribute("fill", "#FFFFFF");
              ghost.setAttribute("opacity", "0.2");
              ghost.setAttribute("filter", "url(#blur-soft)");

              const head = document.createElementNS("http://www.w3.org/2000/svg", "circle");
              head.setAttribute("cx", String(kick.x));
              head.setAttribute("cy", String(kick.y));
              head.setAttribute("r", String(dotR));
              head.setAttribute("fill", "#FFFFFF");
              head.setAttribute("opacity", "1");

              group.append(halo, ghost, head);
              layerRef.current.appendChild(group);

              donePromises.push(new Promise<void>((resolve) => {
                setTimeout(() => {
                  const dur = Math.max(220, flightMs);
                  const easeHead = "cubic-bezier(0.22, 1, 0.36, 1)";
                  const easeY = "cubic-bezier(0.18, 1, 0.32, 1)";
                  const easeTrail = "cubic-bezier(0.32, 1, 0.42, 1)";

                  const hx = head.animate([{ cx: kick.x } as any, { cx: landX } as any], { duration: dur, easing: easeHead, fill: "forwards" });
                  head.animate([{ cy: kick.y } as any, { cy: landY } as any], { duration: dur, easing: easeY, fill: "forwards" });
                  halo.animate([{ cx: kick.x, cy: kick.y } as any, { cx: landX, cy: landY } as any], { duration: dur, easing: easeHead, fill: "forwards" });
                  ghost.animate([{ cx: kick.x } as any, { cx: landX } as any], { duration: dur + 60, easing: easeTrail, fill: "forwards" });
                  ghost.animate([{ cy: kick.y } as any, { cy: landY } as any], { duration: dur + 60, easing: easeTrail, fill: "forwards" });

                  hx.finished.then(() => {
                    head.animate([{ r: `${dotR * 1.06}px` } as any, { r: `${dotR}px` } as any], { duration: 110, easing: "ease-out", fill: "forwards" });
                    ghost.animate([{ opacity: 0.2 }, { opacity: 0 }], { duration: 90, fill: "forwards" });
                    setTimeout(() => { group.remove(); resolve(); }, 120);
                  }).catch(() => { group.remove(); resolve(); });

                  setTimeout(() => {
                    if (group.isConnected) { group.remove(); resolve(); }
                  }, dur + 500);
                }, 40 + delay);
              }));
            }
          }

          await Promise.all(donePromises);
          if (runIdRef.current !== myRun) return;

          for (const ev of wave) {
            for (const t of ev.targets) {
              const to = centerOf(t.tr, t.tc, metrics.cell, metrics.gap);
              addCellFlash(to.x, to.y, metrics.cell);
            }
          }
          opts.onWaveArrivals?.(wi, wave);

          if (wi < plan.waves.length - 1) {
            await new Promise((r) => setTimeout(r, waveGap));
          }
        }
        await new Promise((r) => setTimeout(r, 60));
      } finally {
        if (runIdRef.current === myRun) {
          playingRef.current = false;
          opts.onDone?.();
        }
      }
    },
  }), []);

  return (
    <>
      <g ref={fxRef} />
      <g ref={layerRef} style={{ pointerEvents: "none" }} />
    </>
  );
});
