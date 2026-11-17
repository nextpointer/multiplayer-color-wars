export const PLAYER_PALETTE = [
  { id: "blue", base: "#00C2EE", turnBg: "#60ACD2", fan: "#1FC9F0", confetti: ["#00C2EE", "#7FE3F7", "#FFFFFF"], key: "C" },
  { id: "green", base: "#77C940", turnBg: "#93C679", fan: "#86C958", confetti: ["#77C940", "#A7DE7C", "#FFFFFF"], key: "D" },
  { id: "red", base: "#FE6057", turnBg: "#F79977", fan: "#FE7C76", confetti: ["#FE6057", "#FE9E96", "#FFFFFF"], key: "E" },
  { id: "yellow", base: "#FDBF30", turnBg: "#E2BA5D", fan: "#F6C24C", confetti: ["#FDBF30", "#FED870", "#FFFFFF"], key: "F" },
  { id: "purple", base: "#A05CE6", turnBg: "#BC9CDE", fan: "#AB70E9", confetti: ["#A05CE6", "#C89BF0", "#FFFFFF"], key: "G" },
  { id: "orange", base: "#FF8C42", turnBg: "#F2B792", fan: "#FF9A59", confetti: ["#FF8C42", "#FFAD72", "#FFFFFF"], key: "A" },
  { id: "pink", base: "#F5668F", turnBg: "#EBADBF", fan: "#F6789C", confetti: ["#F5668F", "#F995B1", "#FFFFFF"], key: "Bb" },
  { id: "indigo", base: "#5865E9", turnBg: "#9AA0DF", fan: "#6C77EC", confetti: ["#5865E9", "#8B95F2", "#FFFFFF"], key: "B" },
] as const;

export type PlayerSeat = (typeof PLAYER_PALETTE)[number];

export const SURFACES = {
  cell: "#FCEDD0",
  cellFlash: "#FDF6E6",
  ink: "#2A2E39",
  inkSoft: "#5C6270",
  pill: "#2F333E",
  outline: "#1E242B",
  plum: "#42324C",
  plumPattern: "#5A4E63",
  azure: "#E7F4FC",
  cloud: "#FFFFFF",
  action: "#00C2EE",
  actionPress: "#00A9D6",
  help: "#3A4477",
  whiteText: "#FFFFFF",
} as const;

export function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function mix(hexA: string, hexB: string, bPct: number) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const t = bPct / 100;
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `#${[r, g, bl].map(v => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function cellHighlight(playerBase: string) {
  // mix(#FCEDD0, playerBase, 30%)
  return mix(SURFACES.cell, playerBase, 30);
}

export function playerByIndex(index: number): PlayerSeat {
  return PLAYER_PALETTE[index % PLAYER_PALETTE.length];
}

const KEYS = ["C", "D", "E", "F", "G", "A", "Bb", "B"] as const;

export function visualsForPlayer(base: string, id: number) {
  const safeBase = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(base) ? base : PLAYER_PALETTE[id % PLAYER_PALETTE.length].base;
  return {
    base: safeBase,
    turnBg: mix(safeBase, "#FFFFFF", 45),
    fan: mix(safeBase, "#FFFFFF", 18),
    confetti: [safeBase, mix(safeBase, "#FFFFFF", 55), "#FFFFFF"],
    key: KEYS[id % KEYS.length],
  };
}

export const Z = {
  backdrop: 0,
  board: 10,
  flight: 20,
  hud: 30,
  toast: 40,
  modal: 50,
  countdown: 60,
} as const;

export const DUR = {
  instant: 0.08,
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
  reveal: 0.6,
} as const;

export const EASE = {
  pop: [0.34, 1.56, 0.64, 1] as const,
  snap: [0.22, 1, 0.36, 1] as const,
  sweep: [0.65, 0, 0.35, 1] as const,
  xfade: "easeInOut" as const,
} as const;

export const CHAIN_SPEED = {
  normal: { flightMs: 280, waveGapMs: 80 },
  fast: { flightMs: 200, waveGapMs: 40 },
} as const;

export function seatTilt(seatIndex: number) {
  return seatIndex % 2 === 0 ? -6 : 6;
}
