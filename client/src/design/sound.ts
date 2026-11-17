import * as Tone from "tone";

type SoundName =
  | "ui.tap" | "ui.back" | "dot.add" | "charge.wobble" | "burst.pop"
  | "dot.land" | "capture.chord" | "cascade.tick" | "turn.you" | "turn.other"
  | "count.tick" | "count.go" | "join.pop" | "leave.pop" | "error.thud"
  | "win.fanfare" | "lose.wah";

const KEY_TO_FREQ: Record<string, number> = {
  C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392.0, A: 440.0, Bb: 466.16, B: 493.88,
};

let unlocked = false;
let muted = false;
let limiter: Tone.Limiter | null = null;
let sfxVol: Tone.Volume | null = null;
let musicVol: Tone.Volume | null = null;
let initPromise: Promise<void> | null = null;
const recent: number[] = [];

export function setMuted(v: boolean) { muted = v; }
export function isMuted() { return muted; }

async function ensure() {
  if (unlocked) return;
  if (!initPromise) {
    initPromise = (async () => {
      await Tone.start();
      limiter = new Tone.Limiter(-1).toDestination();
      sfxVol = new Tone.Volume(-6).connect(limiter);
      musicVol = new Tone.Volume(-14).connect(limiter);
      unlocked = true;
    })();
  }
  await initPromise;
}

export function unlockOnGesture() {
  const handler = () => { void ensure(); window.removeEventListener("pointerdown", handler); };
  window.addEventListener("pointerdown", handler, { once: true, passive: true });
}

function rateLimited() {
  const now = performance.now();
  while (recent.length && now - recent[0] > 1000) recent.shift();
  if (recent.length >= 4) return true;
  recent.push(now);
  return false;
}

function note(baseKey: string, semis: number, octave = 5) {
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const base = baseKey === "Bb" ? "A#" : baseKey;
  let idx = names.indexOf(base);
  if (idx < 0) idx = 0;
  let total = idx + semis;
  let oct = octave;
  while (total >= 12) { total -= 12; oct++; }
  while (total < 0) { total += 12; oct--; }
  return `${names[total]}${oct}`;
}

function dotPitch(count: number) {
  return ["C5","D5","E5","G5"][Math.max(0, Math.min(3, count - 1))];
}

export async function play(name: SoundName, opts?: { dotCount?: number; playerKey?: string; wave?: number }) {
  if (muted) return;
  if (!unlocked) await ensure();
  if (!unlocked || !sfxVol) return;
  if (rateLimited() && name !== "burst.pop" && name !== "dot.land") return;
  const now = Tone.now();
  const bus = sfxVol;
  try {
    switch (name) {
      case "ui.tap": {
        const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 } }).connect(bus);
        s.volume.value = -14; s.triggerAttackRelease(520, 0.07, now); s.frequency.exponentialRampTo(660, 0.07, now); setTimeout(()=>s.dispose(),300); break;
      }
      case "ui.back": {
        const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 } }).connect(bus);
        s.volume.value = -16; s.triggerAttackRelease(320, 0.09, now); s.frequency.exponentialRampTo(240, 0.09, now); setTimeout(()=>s.dispose(),300); break;
      }
      case "dot.add": {
        const s = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 } }).connect(bus);
        s.volume.value = -12; s.triggerAttackRelease(dotPitch(opts?.dotCount ?? 1), 0.09, now);
        const n = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.01, sustain: 0 } }).connect(bus);
        n.volume.value = -22; n.triggerAttackRelease(0.01, now); setTimeout(()=>{s.dispose();n.dispose();},300); break;
      }
      case "charge.wobble": {
        const s = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 } }).connect(bus);
        s.volume.value = -12; s.triggerAttackRelease("E5", 0.12, now); s.frequency.linearRampTo(Tone.Frequency("D#5").toFrequency(), 0.12, now); setTimeout(()=>s.dispose(),400); break;
      }
      case "burst.pop": {
        const n = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.06, sustain: 0 } });
        const f = new Tone.Filter(1200, "bandpass", -12).connect(bus); n.connect(f); n.volume.value = -10; n.triggerAttackRelease(0.06, now);
        const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.02 } }).connect(bus);
        s.volume.value = -10; s.triggerAttackRelease(400, 0.15, now); s.frequency.exponentialRampTo(150, 0.15, now); setTimeout(()=>{n.dispose();f.dispose();s.dispose();},400); break;
      }
      case "dot.land": {
        const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }).connect(bus);
        s.volume.value = -18; s.triggerAttackRelease(300, 0.04, now); setTimeout(()=>s.dispose(),200); break;
      }
      case "capture.chord": {
        const root = opts?.playerKey || "C";
        const s1 = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.18, sustain: 0, release: 0.05 } }).connect(bus);
        const s2 = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.18, sustain: 0, release: 0.05 } }).connect(bus);
        s1.volume.value = -12; s2.volume.value = -12;
        s1.triggerAttackRelease(note(root, 0, 4), 0.18, now);
        s2.triggerAttackRelease(note(root, 4, 4), 0.18, now);
        setTimeout(()=>{s1.dispose();s2.dispose();},500); break;
      }
      case "cascade.tick": {
        const root = opts?.playerKey || "C";
        const wave = Math.min(6, opts?.wave ?? 0);
        const s1 = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.15, sustain: 0 } }).connect(bus);
        const s2 = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.15, sustain: 0 } }).connect(bus);
        s1.volume.value = -14; s2.volume.value = -14;
        s1.triggerAttackRelease(note(root, wave * 2, 4), 0.15, now);
        s2.triggerAttackRelease(note(root, 4 + wave * 2, 4), 0.15, now);
        setTimeout(()=>{s1.dispose();s2.dispose();},500); break;
      }
      case "turn.you": {
        const root = opts?.playerKey || "C";
        const seq = [0,4,7,12];
        seq.forEach((se, i) => {
          const s = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.12, sustain: 0 } }).connect(bus);
          s.volume.value = -12; s.triggerAttackRelease(note(root, se, 5), 0.12, now + i*0.07); setTimeout(()=>s.dispose(),600);
        }); break;
      }
      case "turn.other": {
        const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } }).connect(bus);
        s.volume.value = -18; s.triggerAttackRelease(180, 0.12, now);
        const s2 = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } }).connect(bus);
        s2.volume.value = -22; s2.triggerAttackRelease(270, 0.12, now);
        setTimeout(()=>{s.dispose();s2.dispose();},400); break;
      }
      case "count.tick": {
        const n = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } });
        const f = new Tone.Filter(2000, "bandpass", -12).connect(bus); n.connect(f); n.volume.value = -14; n.triggerAttackRelease(0.03, now);
        setTimeout(()=>{n.dispose();f.dispose();},200); break;
      }
      case "count.go": {
        const s = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.2, sustain: 0 } }).connect(bus);
        s.volume.value = -10; s.triggerAttackRelease("C5", 0.1, now); s.triggerAttackRelease("G5", 0.15, now + 0.08);
        setTimeout(()=>s.dispose(),500); break;
      }
      case "join.pop": {
        const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).connect(bus);
        s.volume.value = -12; s.triggerAttackRelease(300, 0.08, now); s.frequency.exponentialRampTo(900, 0.08, now); setTimeout(()=>s.dispose(),300); break;
      }
      case "leave.pop": {
        const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).connect(bus);
        s.volume.value = -16; s.triggerAttackRelease(900, 0.08, now); s.frequency.exponentialRampTo(300, 0.08, now); setTimeout(()=>s.dispose(),300); break;
      }
      case "error.thud": {
        const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } }).connect(bus);
        s.volume.value = -14; s.triggerAttackRelease(100, 0.12, now); setTimeout(()=>s.dispose(),300); break;
      }
      case "win.fanfare": {
        const notes = ["C5","E5","G5","C6"];
        notes.forEach((nn, i) => {
          const s = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 0.2 } }).connect(bus);
          s.volume.value = -10; s.triggerAttackRelease(nn, 0.3, now + i*0.18); setTimeout(()=>s.dispose(),1500);
        }); break;
      }
      case "lose.wah": {
        const notes = ["G4","Eb4","C4"];
        notes.forEach((nn, i) => {
          const s = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.1 } });
          const f = new Tone.Filter(800, "lowpass").connect(bus); s.connect(f);
          s.volume.value = -16; s.triggerAttackRelease(nn, 0.25, now + i*0.22); setTimeout(()=>{s.dispose();f.dispose();},1200);
        }); break;
      }
    }
  } catch { /* ignore audio errors */ }
}

export function haptic(kind: "light" | "medium" | "success") {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    if (kind === "light") navigator.vibrate(10);
    else if (kind === "medium") navigator.vibrate(25);
    else navigator.vibrate([30, 40, 30]);
  } catch {}
}
