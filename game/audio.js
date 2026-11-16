// audio.js — VOIDLANTERN procedural sound.
// Every sound is synthesised with WebAudio: no audio files, no network.
// The game starts muted until the first user gesture (browser autoplay
// policy), then the AudioContext is resumed on first input.

let ctx = null;
let muted = false;
let master = null;

export function isMuted() { return muted; }

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = muted ? 0 : 0.5;
}

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

// One short oscillator blip with an exponential decay envelope.
function blip(freqA, freqB, dur, type, vol) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqA, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqB), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

// Filtered noise burst (hits, deaths): a buffer of white noise through a
// low-pass filter whose cutoff falls as it plays. The noise comes from a
// fixed-seed mulberry32, not Math.random, so the game's randomness stays
// seeded and reproducible.
let noiseSeed = 0x9e3779b9;
function noiseSample() {
  noiseSeed |= 0; noiseSeed = (noiseSeed + 0x6d2b79f5) | 0;
  let t = Math.imul(noiseSeed ^ (noiseSeed >>> 15), 1 | noiseSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
}

function noiseBurst(dur, cutoff, vol) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = noiseSample() * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.setValueAtTime(cutoff, t0);
  filt.frequency.exponentialRampToValueAtTime(120, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt); filt.connect(g); g.connect(master);
  src.start(t0);
}

export const sfx = {
  shoot() { blip(920, 320, 0.09, "square", 0.10); },
  hit() { noiseBurst(0.08, 2400, 0.16); },
  kill() { blip(420, 60, 0.22, "sawtooth", 0.16); noiseBurst(0.16, 1600, 0.14); },
  hurt() { blip(180, 55, 0.28, "sawtooth", 0.22); noiseBurst(0.2, 900, 0.18); },
  ember() { blip(1180, 1760, 0.12, "sine", 0.14); },
  dash() { noiseBurst(0.14, 3200, 0.10); blip(300, 700, 0.12, "sine", 0.08); },
  wave() { blip(196, 392, 0.5, "triangle", 0.16); blip(294, 588, 0.5, "triangle", 0.10); },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => blip(f, f, 0.4, "triangle", 0.16), i * 130);
    });
  },
  lose() { blip(220, 38, 1.1, "sawtooth", 0.18); },
};
