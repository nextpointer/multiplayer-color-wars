import type { Transition } from "motion/react";

export const spring = {
  flightX: { type: "spring", stiffness: 420, damping: 30, mass: 0.85 } as Transition,
  flightY: { type: "spring", stiffness: 388, damping: 30, mass: 0.85 } as Transition,
  pop: { type: "spring", stiffness: 620, damping: 22, mass: 0.7 } as Transition,
  settle: { type: "spring", stiffness: 700, damping: 18, mass: 0.5 } as Transition,
  soft: { type: "spring", stiffness: 320, damping: 32 } as Transition,
  trailA: { type: "spring", stiffness: 260, damping: 26 } as Transition,
  trailB: { type: "spring", stiffness: 200, damping: 24 } as Transition,
} as const;

export const SPRING = spring;

export const SPEED = {
  normal: { flightBoostMs: 0, waveGap: 80, hopTargetMs: 280 },
  fast: { flightBoostMs: 0, waveGap: 40, hopTargetMs: 200 },
} as const;

export const DUR = {
  instant: 0.08,
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
  reveal: 0.6,
} as const;

export const EASE = {
  pop: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
  snap: [0.22, 1, 0.36, 1] as [number, number, number, number],
  sweep: [0.65, 0, 0.35, 1] as [number, number, number, number],
  xfade: "easeInOut" as const,
} as const;

export const CHAIN_SPEED_PRESETS = {
  normal: { flightMs: SPEED.normal.hopTargetMs, waveGapMs: SPEED.normal.waveGap },
  fast: { flightMs: SPEED.fast.hopTargetMs, waveGapMs: SPEED.fast.waveGap },
} as const;

export type ChainSpeed = keyof typeof CHAIN_SPEED_PRESETS;
