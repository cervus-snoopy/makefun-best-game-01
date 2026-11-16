// engine.js — VOIDLANTERN shared math + seeded RNG.
// No dependencies, no network. Everything the game draws or spawns that
// must replay the same way comes from mulberry32, never Math.random.

// mulberry32: a tiny seeded RNG. One function, no state outside the
// closure, so the same seed always replays the same stream of draws.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

// Pick a point on the arena edge, at least `margin` away from (px, py).
// Used for enemy spawns: they always enter from the dark, never on top
// of the Keeper.
export function edgePoint(rng, w, h, px, py, margin) {
  for (let tries = 0; tries < 12; tries++) {
    const side = Math.floor(rng() * 4);
    let x, y;
    if (side === 0) { x = rng() * w; y = -24; }
    else if (side === 1) { x = w + 24; y = rng() * h; }
    else if (side === 2) { x = rng() * w; y = h + 24; }
    else { x = -24; y = rng() * h; }
    if (dist2(x, y, px, py) > margin * margin) return { x, y };
  }
  return { x: w / 2, y: -24 };
}

// Seeded starfield: fixed stars so the background never flickers between
// runs, but each star still twinkles on its own phase.
export function makeStars(rng, w, h, count) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rng() * w,
      y: rng() * h,
      r: 0.5 + rng() * 1.4,
      phase: rng() * TAU,
      speed: 0.4 + rng() * 1.2,
      warm: rng() < 0.25,
    });
  }
  return stars;
}
