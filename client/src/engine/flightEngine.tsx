import React, { useCallback, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { motion, animate } from "motion/react";
import { SPRING } from "../design/motion";
import type { MoveAnimationPlan, BurstEvent } from "./chainAdapter";
import { CHAIN_SPEED_PRESETS, type ChainSpeed } from "../design/motion";

export interface FlightDot {
  id: string;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  color: string;
}

export interface FlightEngineHandle {
  play: (plan: MoveAnimationPlan, opts: { speed: ChainSpeed; reduced: boolean; originColor: string; metrics: { cell: number; gap: number }; onWaveStart?: (wave: number) => void; onWaveArrivals?: (wave: number, events: BurstEvent[]) => void; onCellFlash?: (r:number,c:number)=>void; onDone?: () => void }) => Promise<void>;
  isPlaying: () => boolean;
  clear: () => void;
}

function centerOf(r: number, c: number, cell: number, gap: number) {
  return { x: c * (cell + gap) + cell / 2, y: r * (cell + gap) + cell / 2 };
}

export const FlightEngine = forwardRef<FlightEngineHandle, { }>(function FlightEngine(_props, ref) {
  const [dots, setDots] = useState<FlightDot[]>([]);
  const playingRef = useRef(false);
  const runIdRef = useRef(0);

  const clear = useCallback(() => { setDots([]); playingRef.current = false; }, []);

  useImperativeHandle(ref, () => ({
    isPlaying: () => playingRef.current,
    clear,
    play: async (plan, opts) => {
      const myRun = ++runIdRef.current;
      playingRef.current = true;
      try {
        if (!plan.waves.length || opts.reduced) {
          opts.onDone?.();
          return;
        }
        const speed = CHAIN_SPEED_PRESETS[opts.speed];
        for (let wi = 0; wi < plan.waves.length; wi++) {
          if (runIdRef.current !== myRun) return;
          const wave = plan.waves[wi];
          opts.onWaveStart?.(wi);
          // flash origins
          for (const ev of wave) opts.onCellFlash?.(ev.r, ev.c);
          // launch flights
          const flights: { id: string; dotId: string; toX: number; toY: number }[] = [];
          setDots(prev => {
            let next = [...prev];
            let sub = 0;
            for (let ei = 0; ei < wave.length; ei++) {
              const ev = wave[ei];
              const from = centerOf(ev.r, ev.c, opts.metrics.cell, opts.metrics.gap);
              for (let ti = 0; ti < ev.targets.length; ti++) {
                const t = ev.targets[ti];
                const to = centerOf(t.tr, t.tc, opts.metrics.cell, opts.metrics.gap);
                const dotId = `${myRun}-${ev.id}-${ti}-${sub}`;
                sub++;
                next.push({ id: dotId, x: from.x, y: from.y, scale: 1, opacity: 1, color: opts.originColor });
                flights.push({ id: ev.id, dotId, toX: to.x, toY: to.y });
              }
            }
            return next;
          });
          // animate flights (slower, smooth)
          const duration = 0.55;
          await new Promise<void>(resolve => {
            // small delay to let state mount dots
            requestAnimationFrame(() => {
              let remaining = flights.length;
              if (remaining === 0) { resolve(); return; }
              flights.forEach((f) => {
                const el = document.querySelector(`[data-flight-id="${f.dotId}"]`) as HTMLElement | null;
                if (!el) { remaining--; if (remaining <= 0) resolve(); return; }
                const controlsX = animate(el, { x: f.toX }, { duration, ease: "easeInOut" });
                const controlsY = animate(el, { y: f.toY }, { duration, ease: "easeInOut" });
                Promise.all([controlsX.finished, controlsY.finished]).then(() => {
                  remaining--;
                  if (remaining <= 0) resolve();
                }).catch(() => { remaining--; if (remaining <= 0) resolve(); });
              });
              // safety timeout
              setTimeout(() => resolve(), 700);
            });
          });
          if (runIdRef.current !== myRun) return;
          // remove this wave's dots and report arrivals
          setDots(prev => prev.filter(d => !d.id.startsWith(`${myRun}-`) || !flights.find(f => f.dotId === d.id)));
          for (const ev of wave) for (const t of ev.targets) opts.onCellFlash?.(t.tr, t.tc);
          opts.onWaveArrivals?.(wi, wave);
          if (wi < plan.waves.length - 1) {
            await new Promise(r => setTimeout(r, 180));
          }
        }
        await new Promise(r => setTimeout(r, 60));
      } finally {
        if (runIdRef.current === myRun) {
          setDots([]);
          playingRef.current = false;
          opts.onDone?.();
        }
      }
    },
  }), [clear]);

  return (
    <>
      {dots.map(d => (
        <motion.div
          key={d.id}
          data-flight-id={d.id}
          initial={{ x: d.x, y: d.y, scale: 1, opacity: 1 }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "var(--dot)",
            height: "var(--dot)",
            marginLeft: "calc(var(--dot) / -2)",
            marginTop: "calc(var(--dot) / -2)",
            borderRadius: "50%",
            background: d.color,
            pointerEvents: "none",
            willChange: "transform",
          }}
        />
      ))}
    </>
  );
});
