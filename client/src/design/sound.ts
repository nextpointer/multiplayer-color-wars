export type SoundName =
  | "ui.tap" | "ui.back" | "dot.add" | "charge.wobble" | "burst.pop"
  | "dot.land" | "capture.chord" | "cascade.tick" | "turn.you" | "turn.other"
  | "count.tick" | "count.go" | "join.pop" | "leave.pop" | "error.thud"
  | "win.fanfare" | "lose.wah";

const NOTE_FREQ: Record<string, number> = {
  C4: 261.63, "C#4": 277.18, D4: 293.66, "D#4": 311.13, Eb4: 311.13, E4: 329.63, F4: 349.23, "F#4": 369.99, G4: 392.0, "G#4": 415.3, A4: 440.0, "A#4": 466.16, Bb4: 466.16, B4: 493.88,
  C5: 523.25, "C#5": 554.37, D5: 587.33, "D#5": 622.25, Eb5: 622.25, E5: 659.25, F5: 698.46, "F#5": 739.99, G5: 783.99, "G#5": 830.61, A5: 880.0, "A#5": 932.33, Bb5: 932.33, B5: 987.77,
  C6: 1046.5,
};
const ROOT_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, Bb: 10, B: 11 };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let muted = false;
let hapticsEnabled = true;
let initPromise: Promise<void> | null = null;
const recent: number[] = [];
const recentByKind = new Map<string, number>();
let lastHapticAt = 0;
let noiseBuf: AudioBuffer | null = null;

export function setMuted(v: boolean) {
  muted = v;
  if (master && ctx) master.gain.setTargetAtTime(v ? 0 : 0.8, ctx.currentTime, 0.01);
}
export function isMuted() { return muted; }
export function setHapticsEnabled(v: boolean) { hapticsEnabled = v; }

function ensureNoiseBuffer(ac: AudioContext) {
  if (noiseBuf) return noiseBuf;
  const len = ac.sampleRate; // 1s
  const b = ac.createBuffer(1, len, ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = b;
  return b;
}

async function ensure() {
  if (unlocked && ctx && master) return;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.8;
        master.connect(ctx.destination);
        ensureNoiseBuffer(ctx);
        if (ctx.state === "suspended") await ctx.resume();
        unlocked = true;
      } catch {
        // audio unavailable
      }
    })();
  }
  await initPromise;
}

export function unlockOnGesture() {
  const handler = () => { void ensure(); cleanup(); };
  const cleanup = () => {
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("touchstart", handler);
    window.removeEventListener("keydown", handler);
  };
  window.addEventListener("pointerdown", handler, { once: true, passive: true });
  window.addEventListener("touchstart", handler, { once: true, passive: true });
  window.addEventListener("keydown", handler, { once: true });
}

function rateLimited(name: SoundName) {
  const now = performance.now();
  while (recent.length && now - recent[0] > 1000) recent.shift();
  if (name === "burst.pop" || name === "cascade.tick" || name === "dot.land") {
    const last = recentByKind.get(name) || 0;
    if (now - last < 60) return true;
    recentByKind.set(name, now);
    return false;
  }
  if (recent.length >= 6) return true;
  recent.push(now);
  return false;
}

function noteFreq(baseKey: string, semis: number, octave = 5) {
  const base = (ROOT_SEMI[baseKey] ?? 0) + semis + octave * 12;
  return 440 * Math.pow(2, (base - 69) / 12);
}

function dotPitch(count: number) {
  return [523.25, 587.33, 659.25, 783.99][Math.max(0, Math.min(3, count - 1))];
}

function envGain(ac: AudioContext, t: number, a: number, d: number, peak: number, sustain = 0) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (sustain > 0) {
    g.gain.linearRampToValueAtTime(Math.max(0.0001, peak * sustain), t + a + d);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  return g;
}

function tone(ac: AudioContext, out: AudioNode, freq: number, t: number, dur: number, type: OscillatorType, vol: number, freqEnd?: number) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, freq), t);
  if (freqEnd && freqEnd > 20) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = envGain(ac, t, 0.002, dur, vol);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.03);
}

function noiseHit(ac: AudioContext, out: AudioNode, t: number, dur: number, vol: number, hp = 400, lp = 4000) {
  const src = ac.createBufferSource();
  src.buffer = ensureNoiseBuffer(ac);
  const g = envGain(ac, t, 0.001, dur, vol);
  const hpf = ac.createBiquadFilter(); hpf.type = "highpass"; hpf.frequency.value = hp;
  const lpf = ac.createBiquadFilter(); lpf.type = "lowpass"; lpf.frequency.value = lp;
  src.connect(hpf); hpf.connect(lpf); lpf.connect(g); g.connect(out);
  src.start(t); src.stop(t + dur + 0.02);
}

export async function play(name: SoundName, opts?: { dotCount?: number; playerKey?: string; wave?: number; step?: number }) {
  if (muted) return;
  if (!unlocked) await ensure();
  if (!ctx || !master || !unlocked) return;
  if (ctx.state === "suspended") { try { await ctx.resume(); } catch {} }
  if (rateLimited(name)) return;
  const ac = ctx;
  const out = master;
  const t = ac.currentTime;
  try {
    switch (name) {
      case "ui.tap":
        tone(ac, out, 520, t, 0.06, "sine", 0.05, 660);
        break;
      case "ui.back":
        tone(ac, out, 320, t, 0.08, "sine", 0.045, 240);
        break;
      case "dot.add":
        tone(ac, out, dotPitch(opts?.dotCount ?? 1), t, 0.09, "triangle", 0.07);
        noiseHit(ac, out, t, 0.015, 0.015, 1200, 6000);
        break;
      case "charge.wobble":
        tone(ac, out, 659.25, t, 0.12, "triangle", 0.06, 622.25);
        break;
      case "burst.pop":
        noiseHit(ac, out, t, 0.05, 0.08, 300, 2500);
        tone(ac, out, 360, t, 0.12, "sine", 0.07, 140);
        break;
      case "dot.land":
        tone(ac, out, 320, t, 0.045, "sine", 0.03, 260);
        break;
      case "capture.chord": {
        const root = opts?.playerKey || "C";
        tone(ac, out, noteFreq(root, 0, 4), t, 0.16, "triangle", 0.045);
        tone(ac, out, noteFreq(root, 4, 4), t, 0.16, "triangle", 0.045);
        break;
      }
      case "cascade.tick": {
        const root = opts?.playerKey || "C";
        const step = Math.min(6, opts?.step ?? opts?.wave ?? 0);
        tone(ac, out, noteFreq(root, step * 2, 4), t, 0.12, "triangle", 0.035);
        tone(ac, out, noteFreq(root, 4 + step * 2, 4), t, 0.12, "triangle", 0.03);
        break;
      }
      case "turn.you": {
        const root = opts?.playerKey || "C";
        [0, 4, 7, 12].forEach((se, i) => tone(ac, out, noteFreq(root, se, 5), t + i * 0.07, 0.11, "triangle", 0.05));
        break;
      }
      case "turn.other":
        tone(ac, out, 180, t, 0.1, "sine", 0.03);
        tone(ac, out, 270, t, 0.1, "sine", 0.02);
        break;
      case "count.tick":
        noiseHit(ac, out, t, 0.03, 0.04, 1200, 5000);
        break;
      case "count.go":
        tone(ac, out, 523.25, t, 0.08, "triangle", 0.06);
        tone(ac, out, 783.99, t + 0.08, 0.12, "triangle", 0.06);
        break;
      case "join.pop":
        tone(ac, out, 300, t, 0.08, "sine", 0.055, 900);
        break;
      case "leave.pop":
        tone(ac, out, 900, t, 0.08, "sine", 0.045, 300);
        break;
      case "error.thud":
        tone(ac, out, 110, t, 0.14, "sine", 0.07, 70);
        break;
      case "win.fanfare":
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, out, f, t + i * 0.16, 0.28, "triangle", 0.06));
        break;
      case "lose.wah":
        [392.0, 311.13, 261.63].forEach((f, i) => tone(ac, out, f, t + i * 0.2, 0.26, "sine", 0.045, f * 0.92));
        break;
    }
  } catch { /* ignore audio errors */ }
}

export function haptic(kind: "light" | "medium" | "success") {
  if (!hapticsEnabled) return;
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  const now = performance.now();
  const minGap = kind === "light" ? 45 : kind === "medium" ? 90 : 180;
  if (now - lastHapticAt < minGap) return;
  lastHapticAt = now;
  try {
    if (kind === "light") navigator.vibrate(8);
    else if (kind === "medium") navigator.vibrate(18);
    else navigator.vibrate([24, 30, 24]);
  } catch {}
}
