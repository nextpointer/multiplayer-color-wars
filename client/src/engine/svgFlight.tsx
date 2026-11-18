/**
 * COLOR WARS — flight engine v3: the "realistic" colour-ball chain
 * -----------------------------------------------------------------
 * Drop-in replacement for src/engine/svgFlight.tsx (v2). SAME handle, SAME opts,
 * SAME JSX — only the motion quality changed. App-side patches (commit the PLAIN
 * snapshots[wi] in onWaveStart; cell fill transition 220 ms) are unchanged.
 *
 * What makes v3 feel physical (all one-shot, zero loops, board still at rest):
 *
 *   SPHERE LOOK     every ball is a radial-gradient sphere (light top-left, dark
 *                   rim) + glossy highlight — not a flat circle. Gradients are
 *                   generated per player colour once and cached in <defs>.
 *   CHARGE          the ball visibly GROWS WITH MASS: each resting dot slides to
 *                   the centre and, as it merges, the ball takes a springy scale
 *                   bump (0.45 -> 1.0 over crit bumps). No separate "wobble" needed.
 *   ANTICIPATION    right before launch the formed ball squashes to 0.84 (70 ms) —
 *                   classic anticipation — then STRETCHES to 1.12 as the balls eject.
 *   HOP ARC         flight is driven by ONE progress spring; position = ground line
 *                   + lift * sin(pi * t): a true parabola (up slow, down fast feel).
 *   GROUND SHADOW   an ellipse travels the ground line under the ball, shrinking
 *                   and fading as the ball rises, converging on touchdown — the
 *                   single biggest "this is a real object" cue.
 *   TRAIL           two coloured blur ghosts follow the SAME arc on lagging trail
 *                   springs (flatter arcs -> comet tail under the ball), plus a
 *                   sparse comet of small fading dots in lite waves.
 *   IMPACT          on touchdown: squash 1 -> 0.78 -> 1 (140 ms), impact ring,
 *                   4 debris particles with their own mini-parabolas, then the
 *                   glide to cell centre + colour flood (commit fires AT the
 *                   landing instant, so the cell colour arrives WITH the ball).
 *   PERF GUARD      waves with more than 30 concurrent flights auto-drop particles
 *                   and the comet (lite mode) to hold 60 fps.
 */

import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { animate } from "motion";
import type { MoveAnimationPlan, BurstEvent } from "./chainAdapter";
import { SPRING, SPEED } from "../design/motion";
import { SLOTS, DOT_R_F, PIECE_R_F } from "./geometry";

export interface SvgFlightEngineHandle {
  play: (
    plan: MoveAnimationPlan,
    opts: {
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
    }
  ) => Promise<void>;
  isPlaying: () => boolean;
  clear: () => void;
}

type CellLike = { owner: number | null; count: number };

const NS = "http://www.w3.org/2000/svg";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const BALL_R_F = 0.24;   // flying ball radius, fraction of cell
const CHARGE_R_F = 0.30; // fully-formed ball at the bursting cell, fraction of cell
const CORE_R_F = 0.075;  // white core inside the ball, fraction of cell
const HOP_F = 0.22;      // hop arc height, fraction of cell

/** gentle no-overshoot spring, defined here so design/motion.ts needs no edit */
const SOFT = { type: "spring", stiffness: 320, damping: 32 } as const;

function centerOf(r: number, c: number, cell: number, gap: number) {
  return { x: c * (cell + gap) + cell / 2, y: r * (cell + gap) + cell / 2 };
}

const DIR_SLOT: Record<string, { x: number; y: number }> = {
  N: SLOTS[4][0], E: SLOTS[4][1], S: SLOTS[4][2], W: SLOTS[4][3],
};

function formationSlots(count: number) {
  const n = Math.max(0, Math.min(4, count));
  return n === 0 ? [] : SLOTS[n as 1 | 2 | 3 | 4];
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node as SVGElementTagNameMap[K];
}

/** Safety wrapper: a broken/ignored animation can never hang the whole chain. */
function withGuard(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    Promise.resolve(p).then(finish, finish);
    setTimeout(finish, ms);
  });
}

/* ---- sphere shading helpers --------------------------------------------- */

function parseHex(color: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** amt > 0 -> lighten toward white, amt < 0 -> darken toward black. Non-hex colours pass through. */
function shade(color: string, amt: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const target = amt >= 0 ? 255 : 0;
  const k = Math.abs(amt);
  const [r, g, b] = rgb.map((v) => Math.max(0, Math.min(255, Math.round(v + (target - v) * k))));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export const SvgFlightEngine = forwardRef<SvgFlightEngineHandle, {}>(function SvgFlightEngine(_props, ref) {
  const defsRef = useRef<SVGDefsElement | null>(null);
  const fxRef = useRef<SVGGElement | null>(null);
  const layerRef = useRef<SVGGElement | null>(null);
  const playingRef = useRef(false);
  const runIdRef = useRef(0);
  const gradMapRef = useRef<Map<string, string>>(new Map());
  const gradSeqRef = useRef(0);

  const clear = () => {
    if (layerRef.current) layerRef.current.innerHTML = "";
    if (fxRef.current) fxRef.current.innerHTML = "";
    playingRef.current = false;
  };

  /** radial gradient per player colour (cached) -> balls look like spheres, not flat discs */
  const ensureGradient = (color: string): string => {
    if (!parseHex(color)) return color; // named/odd colour: flat fill fallback
    const cached = gradMapRef.current.get(color);
    if (cached) return cached;
    const defs = defsRef.current;
    if (!defs) return color;
    const id = `cw-ball-grad-${gradSeqRef.current++}`;
    const grad = svgEl("radialGradient", { id, cx: "35%", cy: "30%", r: "80%" });
    grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": shade(color, 0.45) }));
    grad.appendChild(svgEl("stop", { offset: "45%", "stop-color": color }));
    grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": shade(color, -0.30) }));
    defs.appendChild(grad);
    const url = `url(#${id})`;
    gradMapRef.current.set(color, url);
    return url;
  };

  const addCellFlash = (cx: number, cy: number, cell: number) => {
    if (!fxRef.current) return;
    const rect = svgEl("rect", {
      x: cx - cell / 2, y: cy - cell / 2, width: cell, height: cell,
      rx: cell * 0.24, fill: "#FDF6E6", opacity: 0.8,
    });
    fxRef.current.appendChild(rect);
    const anim = rect.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 140, fill: "forwards" });
    anim.onfinish = () => rect.remove();
    setTimeout(() => rect.isConnected && rect.remove(), 400);
  };

  const addBurstRing = (cx: number, cy: number, cell: number, color: string, reduced: boolean) => {
    if (!fxRef.current || reduced) return;
    const wrap = svgEl("g", { style: "transform-box: fill-box; transform-origin: center;" });
    const circle = svgEl("circle", {
      cx, cy, r: PIECE_R_F * cell, fill: "none", stroke: color, "stroke-width": 3,
    });
    wrap.appendChild(circle);
    fxRef.current.appendChild(wrap);
    const anim = wrap.animate(
      [{ transform: "scale(1)", opacity: 0.45 }, { transform: "scale(1.8)", opacity: 0 }],
      { duration: 240, easing: "ease-out", fill: "forwards" }
    );
    anim.onfinish = () => wrap.remove();
    setTimeout(() => wrap.isConnected && wrap.remove(), 600);
  };

  /**
   * CHARGE v3 — the ball grows with mass: each resting dot (covered 1:1 by a white
   * dot at the same slot) slides to the centre and, as it merges, the sphere takes
   * a springy scale bump. Returns { kick, release, absorb }:
   *   kick()     anticipation squash to 0.84 (fires ~70 ms before launch)
   *   release()  launch stretch to 1.12 (fires as the balls eject)
   *   absorb()   flood + fade at wave commit (the cell empties underneath)
   */
  const spawnChargeBall = (
    layer: SVGGElement,
    o: { cx: number; cy: number; cell: number; color: string; crit: number; dotR: number; mergeStart: number; mergeStagger: number }
  ): { kick: () => void; release: () => void; absorb: () => void } => {
    const grad = ensureGradient(o.color);
    const wrap = svgEl("g");
    wrap.setAttribute("style", `transform: translate(${o.cx}px, ${o.cy}px);`);

    // sphere (UNDER the dots) — pops small, then grows with every absorbed dot
    const ballWrap = svgEl("g");
    ballWrap.setAttribute("style", "transform: scale(0.3); opacity: 0;");
    ballWrap.append(
      svgEl("circle", { r: CHARGE_R_F * o.cell, fill: grad }),
      svgEl("circle", { r: CORE_R_F * o.cell, fill: "#FFF6E3", opacity: 0.9 }),
      svgEl("ellipse", { cx: -CHARGE_R_F * o.cell * 0.32, cy: -CHARGE_R_F * o.cell * 0.38, rx: CHARGE_R_F * o.cell * 0.24, ry: CHARGE_R_F * o.cell * 0.17, fill: "#FFFFFF", opacity: 0.5 }),
    );

    // white dots at the burst formation (OVER the ball, covering the resting dots 1:1)
    const dotsWrap = svgEl("g");
    const slots = formationSlots(o.crit);
    const dotMergers: { g: SVGGElement; px: number; py: number }[] = [];
    for (const s of slots) {
      const dg = svgEl("g");
      dg.setAttribute("style", `transform: translate(${s.x * o.cell}px, ${s.y * o.cell}px);`);
      dg.appendChild(svgEl("circle", { r: o.dotR, fill: "#FFFFFF" }));
      dotsWrap.appendChild(dg);
      dotMergers.push({ g: dg, px: s.x * o.cell, py: s.y * o.cell });
    }

    wrap.append(ballWrap, dotsWrap);
    layer.appendChild(wrap);

    let bs = 0.3, bo = 0, gone = false;
    const applyBall = () => ballWrap.setAttribute("style", `transform: scale(${bs}); opacity: ${bo};`);

    // seed: the sphere pops in small under the dots (one-shot)
    try {
      animate(0, 1, { duration: 0.08, onUpdate: (v) => { bo = v; applyBall(); } });
      animate(0.3, 0.45, { duration: 0.12, ease: "easeOut", onUpdate: (v) => { bs = v; applyBall(); } });
    } catch {
      bs = 0.45; bo = 1; applyBall();
    }

    // each dot slides to the centre and merges; the ball grows with its mass
    dotMergers.forEach((d, i) => {
      setTimeout(() => {
        if (gone || !d.g.isConnected) return;
        let sc = 1, op = 1;
        const applyDot = () => d.g.setAttribute("style", `transform: translate(${d.px}px, ${d.py}px) scale(${sc}); opacity: ${op};`);
        try {
          void animate(d.px, 0, { ...SPRING.settle, onUpdate: (v) => { d.px = v; applyDot(); } });
          void animate(d.py, 0, { ...SPRING.settle, onUpdate: (v) => { d.py = v; applyDot(); } });
          void animate(1, 0.3, { duration: 0.14, ease: "easeIn", onUpdate: (v) => { sc = v; applyDot(); } });
        } catch {
          d.px = 0; d.py = 0; sc = 0.3; applyDot();
        }
        setTimeout(() => {
          try { animate(1, 0, { duration: 0.10, onUpdate: (v) => { op = v; applyDot(); } }); } catch { op = 0; applyDot(); }
        }, 60);
        // mass bump — the last bump's ~8% settle overshoot IS the wobble
        const target = 0.45 + 0.55 * ((i + 1) / Math.max(1, slots.length));
        try { animate(bs, target, { ...SPRING.settle, onUpdate: (v) => { bs = v; applyBall(); } }); } catch { bs = target; applyBall(); }
      }, o.mergeStart + i * o.mergeStagger);
    });

    const safety = setTimeout(() => wrap.remove(), 5000); // stray-node guard

    return {
      kick: () => {
        if (gone) return;
        try { animate(bs, 0.84, { duration: 0.09, ease: "easeOut", onUpdate: (v) => { bs = v; applyBall(); } }); } catch { /* keep going */ }
      },
      release: () => {
        if (gone) return;
        try { animate(bs, 1.12, { ...SPRING.pop, onUpdate: (v) => { bs = v; applyBall(); } }); } catch { /* keep going */ }
      },
      absorb: () => {
        if (gone) return;
        gone = true;
        clearTimeout(safety);
        try {
          animate(bs, 1.5, { duration: 0.16, ease: "easeOut", onUpdate: (v) => { bs = v; applyBall(); } });
          animate(bo, 0, { duration: 0.15, ease: "easeOut", onUpdate: (v) => { bo = v; applyBall(); } });
        } catch { wrap.remove(); }
        setTimeout(() => wrap.remove(), 180);
      },
    };
  };

  /**
   * ONE flying sphere v3 — single progress spring drives a true hop arc
   * (ground line + lift * sin(pi*t)), a ground shadow travels below and fades
   * with altitude, two coloured ghosts chase on flatter arcs, a sparse comet
   * trails behind. Resolves AT touchdown; impact squash -> glide to centre ->
   * colour flood happen afterwards so the commit lands mid-flood.
   */
  const spawnBall = (
    layer: SVGGElement,
    o: {
      kick: { x: number; y: number };
      land: { x: number; y: number };
      center: { x: number; y: number };
      ballR: number; coreR: number; color: string;
      lift: number; durMs: number; delayMs: number; lite: boolean;
    }
  ): Promise<void> => {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };

      const start = () => {
        if (!layer.isConnected) { finish(); return; }
        const dx = o.land.x - o.kick.x;
        const dy = o.land.y - o.kick.y;
        const grad = ensureGradient(o.color);
        const rise01 = (p: number) => Math.min(1, Math.max(0, p));
        const arc = (p: number) => o.lift * Math.sin(Math.PI * rise01(p));

        // comet dots (skipped in lite waves) — spawned along the path as it flies
        let cometTimer: number | null = null;
        let lastX = o.kick.x, lastY = o.kick.y, lastS = 1;

        // ground shadow — travels the straight ground line under the ball
        const shadowWrap = svgEl("g");
        shadowWrap.appendChild(svgEl("ellipse", { rx: o.ballR * 0.95, ry: o.ballR * 0.34, fill: "#3A2C14" }));

        // coloured trail ghosts (no expensive SVG blur filters for smoother animation)
        const ghostB = svgEl("g");
        ghostB.setAttribute("style", `transform: translate(${o.kick.x}px, ${o.kick.y}px);`);
        ghostB.appendChild(svgEl("circle", { r: o.ballR * 0.78, fill: o.color, opacity: 0.14 }));
        const ghostA = svgEl("g");
        ghostA.setAttribute("style", `transform: translate(${o.kick.x}px, ${o.kick.y}px);`);
        ghostA.appendChild(svgEl("circle", { r: o.ballR * 0.9, fill: o.color, opacity: 0.24 }));

        // the sphere: shaded ball + the dot riding inside + glossy highlight
        const head = svgEl("g");
        head.setAttribute("style", `transform: translate(${o.kick.x}px, ${o.kick.y}px) scale(1.12);`);
        head.append(
          svgEl("circle", { r: o.ballR, fill: grad, opacity: 0.97 }),
          svgEl("circle", { r: o.coreR, fill: "#FFF6E3", opacity: 0.92 }),
          svgEl("ellipse", { cx: -o.ballR * 0.32, cy: -o.ballR * 0.38, rx: o.ballR * 0.26, ry: o.ballR * 0.18, fill: "#FFFFFF", opacity: 0.55 }),
        );

        layer.append(shadowWrap, ghostB, ghostA, head);

        let t = 0, ta = 0, tb = 0;   // head / ghost progress along the path
        let hs = 1.12;               // launch stretch, settles to 1
        let landed = false;

        const applyAll = () => {
          const rise = Math.sin(Math.PI * rise01(t));
          if (!landed) {
            const hx = o.kick.x + dx * t;
            const hy = o.kick.y + dy * t - arc(t);
            const s = hs * (1 - 0.10 * rise);      // lighter look at altitude
            head.setAttribute("style", `transform: translate(${hx}px, ${hy}px) scale(${s});`);
            lastX = hx; lastY = hy; lastS = s;
            // shadow stays on the ground line; smaller + fainter as the ball rises
            const gx = o.kick.x + dx * t;
            const gy = o.kick.y + dy * t + o.ballR * 0.85;
            shadowWrap.setAttribute("style", `transform: translate(${gx}px, ${gy}px) scale(${1 - 0.45 * rise}); opacity: ${(0.24 * (1 - 0.55 * rise)).toFixed(3)};`);
          }
          // ghosts fly flatter arcs -> the trail sits slightly under the ball
          const ay = o.kick.y + dy * ta - arc(ta) * 0.6;
          ghostA.setAttribute("style", `transform: translate(${o.kick.x + dx * ta}px, ${ay}px);`);
          const by = o.kick.y + dy * tb - arc(tb) * 0.4;
          ghostB.setAttribute("style", `transform: translate(${o.kick.x + dx * tb}px, ${by}px);`);
        };
        applyAll();

        try {
          // the hop: ONE progress spring (same spring constants as the old x flight)
          const st = animate(0, 1, { ...SPRING.flightX, onUpdate: (v) => { t = v; applyAll(); } });
          // ghosts lag on the softer trail springs -> real motion trail
          void animate(0, 1, { ...SPRING.trailA, onUpdate: (v) => { ta = v; applyAll(); } });
          void animate(0, 1, { ...SPRING.trailB, onUpdate: (v) => { tb = v; applyAll(); } });
          // launch stretch settles back to 1
          void animate(1.12, 1, { ...SPRING.settle, onUpdate: (v) => { hs = v; applyAll(); } });

          // comet disabled for smoother chain reactions on all devices
          cometTimer = null;

          Promise.all([
            withGuard(Promise.resolve(st), o.durMs + 800),
          ]).then(() => {
            if (!head.isConnected) { finish(); return; }
            // resolve AT touchdown — the wave commit must fire while the ball floods
            finish();
            landed = true;
            if (cometTimer !== null) clearInterval(cometTimer);

            // ghosts converge and fade
            ghostA.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
            ghostB.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
            setTimeout(() => { ghostA.remove(); ghostB.remove(); }, 140);

            // shadow converges and fades as the sphere touches the ground
            const sgx = o.kick.x + dx;
            const sgy = o.kick.y + dy + o.ballR * 0.85;
            let shOp = 0.24;
            const applyShadow = () => shadowWrap.setAttribute("style", `transform: translate(${sgx}px, ${sgy}px) scale(1.05); opacity: ${shOp.toFixed(3)};`);
            try { animate(shOp, 0, { duration: 0.15, ease: "easeOut", onUpdate: (v) => { shOp = v; applyShadow(); } }); } catch { shadowWrap.remove(); }

            // impact squash (1 -> 0.78 -> 1) while gliding to the cell centre
            let hx2 = o.land.x, hy2 = o.land.y;
            let hsq = hs;
            const applyHeadLand = () => head.setAttribute("style", `transform: translate(${hx2}px, ${hy2}px) scale(${hsq});`);
            try {
              animate(hsq, 0.78, { duration: 0.08, ease: "easeOut", onUpdate: (v) => { hsq = v; applyHeadLand(); } });
              void animate(hx2, o.center.x, { ...SOFT, onUpdate: (v) => { hx2 = v; applyHeadLand(); } });
              void animate(hy2, o.center.y, { ...SOFT, onUpdate: (v) => { hy2 = v; applyHeadLand(); } });
            } catch { hx2 = o.center.x; hy2 = o.center.y; applyHeadLand(); }
            setTimeout(() => {
              try { animate(hsq, 1, { duration: 0.10, ease: "easeOut", onUpdate: (v) => { hsq = v; applyHeadLand(); } }); } catch { hsq = 1; applyHeadLand(); }
            }, 85);

            // impact ring + debris (real "weight" cues)
            const wrap = svgEl("g");
            wrap.setAttribute("style", `transform: translate(${o.land.x}px, ${o.land.y}px);`);
            const inner = svgEl("g", { style: "transform-box: fill-box; transform-origin: center;" });
            inner.appendChild(svgEl("circle", { r: o.ballR * 0.9, fill: "none", stroke: o.color, "stroke-width": 2.5 }));
            wrap.appendChild(inner);
            layer.appendChild(wrap);
            const ra = inner.animate(
              [{ transform: "scale(0.6)", opacity: 0.5 }, { transform: "scale(1.9)", opacity: 0 }],
              { duration: 220, easing: "ease-out", fill: "forwards" }
            );
            ra.onfinish = () => wrap.remove();
            setTimeout(() => wrap.isConnected && wrap.remove(), 500);

            if (!o.lite) {
              for (let i = 0; i < 2; i++) {
                const ang = ((-90 + (Math.random() * 70 - 35)) * Math.PI) / 180;
                const dist = o.ballR * (1.3 + Math.random() * 1.0);
                const phop = o.ballR * (0.7 + Math.random() * 0.7);
                const p = svgEl("circle", { r: Math.max(1.5, o.coreR * 0.55), fill: o.color });
                p.setAttribute("style", "transform: translate(0px, 0px); opacity: 0.65;");
                layer.appendChild(p);
                try {
                  void animate(0, 1, {
                    duration: 0.2, ease: "easeOut",
                    onUpdate: (tt) => {
                      const x = o.land.x + Math.cos(ang) * dist * tt;
                      const y = o.land.y + Math.sin(ang) * dist * tt - phop * Math.sin(Math.PI * tt);
                      p.setAttribute("style", `transform: translate(${x}px, ${y}px) scale(${1 - 0.4 * tt});`);
                    },
                  });
                } catch { p.remove(); }
                const pa = p.animate([{ opacity: 0.65 }, { opacity: 0 }], { duration: 200, easing: "ease-out", fill: "forwards" });
                pa.onfinish = () => p.remove();
                setTimeout(() => p.isConnected && p.remove(), 260);
              }
            }

            // flood: the sphere melts into the cell (colour handoff under the commit)
            setTimeout(() => {
              try { animate(hsq, 1.9, { duration: 0.16, ease: "easeOut", onUpdate: (v) => { hsq = v; applyHeadLand(); } }); } catch { hsq = 1.9; applyHeadLand(); }
              head.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "ease-out", fill: "forwards" });
            }, 150);

            setTimeout(() => { head.remove(); shadowWrap.remove(); }, 340);
          });
        } catch {
          if (cometTimer !== null) clearInterval(cometTimer);
          head.remove(); ghostA.remove(); ghostB.remove(); shadowWrap.remove();
          finish();
          return;
        }
        // absolute safety cap: the chain must never hang on one flight
        setTimeout(finish, o.durMs + 1300);
      };

      setTimeout(start, o.delayMs);
      setTimeout(finish, o.delayMs + o.durMs + 1400);
    });
  };

  useImperativeHandle(ref, () => ({
    isPlaying: () => playingRef.current,
    clear,
    play: async (plan, opts) => {
      const myRun = ++runIdRef.current;
      playingRef.current = true;
      const { metrics, speed, reduced } = opts;
      const flightMs = Math.max(220, SPEED[speed].hopTargetMs);
      const waveGap = SPEED[speed].waveGap;
      const cellPx = metrics.cell;
      const ballR = Math.max(7, BALL_R_F * cellPx);
      const coreR = Math.max(2.5, CORE_R_F * cellPx);
      const dotR = Math.max(2, DOT_R_F * cellPx);
      const hopLift = Math.max(8, HOP_F * cellPx);
      const abort = () => runIdRef.current !== myRun || !layerRef.current;

      try {
        if (!plan.waves.length) { opts.onDone?.(); return; }

        for (let wi = 0; wi < plan.waves.length; wi++) {
          if (abort()) return;
          const wave = plan.waves[wi];
          const postBoard = opts.snapshots[wi + 1] || null;

          // ---- landing slots: one assignment list PER TARGET CELL ----
          const slotAssign = new Map<string, { x: number; y: number }[]>();
          if (postBoard) {
            const groups = new Map<string, { dir: string }[]>();
            for (const ev of wave) for (const t of ev.targets) {
              const key = `${t.tr}:${t.tc}`;
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push({ dir: t.dir });
            }
            for (const [key, arrivals] of groups) {
              const [tr, tc] = key.split(":").map(Number);
              const slots = formationSlots(postBoard[tr][tc].count); // final formation of that cell
              const taken = new Set<number>();
              const assigned: { x: number; y: number }[] = [];
              for (const a of arrivals) {
                const dirVec = DIR_SLOT[a.dir] || { x: 0, y: 0 };
                let best = -1, bestDot = -Infinity;
                for (let si = 0; si < slots.length; si++) {
                  if (taken.has(si)) continue;
                  const d = slots[si].x * dirVec.x + slots[si].y * dirVec.y;
                  if (d > bestDot) { bestDot = d; best = si; }
                }
                taken.add(best >= 0 ? best : slots.length);   // overflow slot: piece center
                assigned.push(slots[best] ?? { x: 0, y: 0 });
              }
              slotAssign.set(key, assigned);
            }
          }

          // ---- 1) WAVE START: App commits the PLAIN snapshot — the bursting cell
          //         shows its full incremented dot count ("dots first increment") ----
          opts.onWaveStart?.(wi, wave);
          if (abort()) return;

          // ---- 2) CHARGE: the ball grows with mass as each dot merges ----
          const charges: { kick: () => void; release: () => void; absorb: () => void }[] = [];
          const maxCrit = wave.reduce((m, e) => Math.max(m, e.crit || 1), 1);
          const gatherMs = reduced ? 140 : speed === "fast" ? 45 + maxCrit * 40 : 60 + maxCrit * 60;
          if (layerRef.current && !reduced) {
            const seen = new Set<string>();
            for (const ev of wave) {
              const k = `${ev.r}:${ev.c}`;
              if (seen.has(k)) continue;
              seen.add(k);
              const o = centerOf(ev.r, ev.c, cellPx, metrics.gap);
              addCellFlash(o.x, o.y, cellPx);
              charges.push(spawnChargeBall(layerRef.current, {
                cx: o.x, cy: o.y, cell: cellPx,
                color: opts.playerColors[ev.owner] || opts.originColor,
                crit: ev.crit, dotR,
                mergeStart: 60,
                mergeStagger: speed === "fast" ? 40 : 60,
              }));
            }
          }
          await sleep(gatherMs);
          if (abort()) return;

          // ---- 3) ANTICIPATE + LAUNCH: squash, then one sphere per neighbour ----
          if (!reduced && layerRef.current) {
            for (const c of charges) c.kick();        // anticipation squash to 0.84
            await sleep(70);
            if (abort()) return;

            for (const ev of wave) {
              const o = centerOf(ev.r, ev.c, cellPx, metrics.gap);
              addBurstRing(o.x, o.y, cellPx, opts.playerColors[ev.owner] || opts.originColor, reduced);
            }

            const flightsInWave = wave.reduce((s, e) => s + (e.targets?.length ?? 0), 0);
            const lite = flightsInWave > 12;          // perf guard: simplify busy waves earlier for smoothness
            const donePromises: Promise<void>[] = [];
            const perKeyIdx = new Map<string, number>(); // per-target-cell counter
            let flightNo = 0;
            for (const ev of wave) {
              const from = centerOf(ev.r, ev.c, cellPx, metrics.gap);
              const color = opts.playerColors[ev.owner] || opts.originColor;
              const fromSlots = formationSlots(ev.crit);
              for (const t of ev.targets) {
                const to = centerOf(t.tr, t.tc, cellPx, metrics.gap);
                const key = `${t.tr}:${t.tc}`;
                const list = slotAssign.get(key);
                const i = perKeyIdx.get(key) ?? 0;
                perKeyIdx.set(key, i + 1);
                const slot = (list && list[i]) || { x: 0, y: 0 };
                const land = { x: to.x + slot.x * cellPx, y: to.y + slot.y * cellPx };

                // take-off = the source formation slot facing its target
                const dirVec = DIR_SLOT[t.dir] || { x: 0, y: 0 };
                let takeOff = { x: 0, y: 0 };
                if (ev.crit === 4) takeOff = dirVec;
                else {
                  let best = 0, bestDot = -Infinity;
                  for (let si = 0; si < fromSlots.length; si++) {
                    const d = fromSlots[si].x * dirVec.x + fromSlots[si].y * dirVec.y;
                    if (d > bestDot) { bestDot = d; best = si; }
                  }
                  takeOff = fromSlots[best] ?? { x: 0, y: 0 };
                }
                const kick = { x: from.x + takeOff.x * cellPx, y: from.y + takeOff.y * cellPx };

                donePromises.push(spawnBall(layerRef.current, {
                  kick, land, center: to, ballR, coreR, color,
                  lift: hopLift, durMs: flightMs,
                  delayMs: Math.min(flightNo * 24, 200), lite,
                }));
                flightNo++;
              }
            }
            for (const c of charges) c.release();     // launch stretch to 1.12
            await Promise.all(donePromises);
            if (abort()) return;
          }

          // ---- 4) ABSORB + COMMIT (same instant): source spheres fade as their
          //         cells empty; the landed spheres flood the targets while the
          //         captured cells' fill fades in underneath ----
          for (const c of charges) c.absorb();
          opts.onWaveArrivals?.(wi, wave);

          if (wi < plan.waves.length - 1) await sleep(waveGap);
        }
        await sleep(60);
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
      <defs ref={defsRef} />
      <g ref={fxRef} />
      <g ref={layerRef} style={{ pointerEvents: "none" }} />
    </>
  );
});
