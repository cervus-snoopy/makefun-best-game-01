// enemies.js — VOIDLANTERN enemy definitions + movement AI.
// Four kinds, each with its own look, speed, health and behaviour, so a
// screenshot reads at a glance: violet wisps swarm, teal skitters dart,
// crimson bulwarks lumber, amber splitters burst apart.

export const ENEMY_TYPES = {
  wisp: {
    name: "Wisp",
    color: "#b78cff",
    core: "#e8dcff",
    radius: 13,
    hp: 1,
    speed: 72,
    score: 10,
    embers: 1,
    touch: 7, // light lost when it touches the Keeper
  },
  skitter: {
    name: "Skitter",
    color: "#4de8c2",
    core: "#d2fff2",
    radius: 11,
    hp: 2,
    speed: 132,
    score: 20,
    embers: 1,
    touch: 6,
  },
  bulwark: {
    name: "Bulwark",
    color: "#ff5d73",
    core: "#ffd6db",
    radius: 24,
    hp: 6,
    speed: 46,
    score: 50,
    embers: 3,
    touch: 12,
  },
  splitter: {
    name: "Splitter",
    color: "#ffb347",
    core: "#fff1d6",
    radius: 15,
    hp: 2,
    speed: 88,
    score: 25,
    embers: 1,
    touch: 8,
    splitsInto: "wisp",
    splitCount: 2,
  },
};

// Create one enemy of `kind` at (x, y). `rng` seeds its wobble phase so
// two enemies never drift in lockstep.
export function spawnEnemy(kind, x, y, rng) {
  const def = ENEMY_TYPES[kind];
  return {
    kind,
    def,
    x, y,
    hp: def.hp,
    maxHp: def.hp,
    radius: def.radius,
    // Per-enemy wobble: a sine drift across the chase line, phased by rng.
    wobblePhase: rng() * Math.PI * 2,
    wobbleAmp: kind === "skitter" ? 46 : 22,
    wobbleFreq: kind === "skitter" ? 3.2 : 1.6,
    // Flash timer set to 1 on hit; the renderer draws a white flash while > 0.
    flash: 0,
    // Stagger: freshly spawned enemies pause a beat at the edge, so the
    // player can see them arrive instead of being ambushed.
    enter: 0.45,
    t: 0,
  };
}

// Steer one enemy toward the Keeper for `dt` seconds. Returns nothing;
// mutates the enemy in place. `time` is the match clock, `rng` feeds the
// skitter's occasional sidestep.
export function steerEnemy(e, px, py, dt, time, rng) {
  e.t += dt;
  if (e.enter > 0) { e.enter -= dt; return; }
  const dx = px - e.x, dy = py - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d, ny = dy / d;
  // Perpendicular wobble so chases curve instead of running straight lines.
  const wob = Math.sin(time * e.wobbleFreq + e.wobblePhase) * e.wobbleAmp;
  const wx = -ny * wob, wy = nx * wob;
  // Skitters sidestep hard every couple of seconds: a short lateral burst.
  let boost = 1;
  if (e.kind === "skitter" && Math.sin(time * 0.9 + e.wobblePhase) > 0.92) boost = 1.7;
  const sp = e.def.speed * boost;
  const mx = (nx * sp + wx * 0.55) * dt;
  const my = (ny * sp + wy * 0.55) * dt;
  const ml = Math.hypot(mx, my) || 1;
  const cap = sp * dt * 1.15;
  e.x += (mx / ml) * Math.min(ml, cap);
  e.y += (my / ml) * Math.min(ml, cap);
  if (e.flash > 0) e.flash -= dt * 6;
}
