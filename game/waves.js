// waves.js — VOIDLANTERN wave composition.
// Ten waves, then dawn breaks and the Keeper wins. Each wave lists how
// many of each kind arrive and how fast they trickle in; later waves mix
// kinds so no two waves play the same. Counts are tuned so wave 1 teaches
// (slow wisps only) and wave 10 demands the dash.

// [wisps, skitters, bulwarks, splitters, spawnIntervalSeconds]
const WAVE_TABLE = [
  [6, 0, 0, 0, 1.15],  // 1: learn to move and shoot
  [9, 2, 0, 0, 1.00],  // 2: first skitters
  [10, 4, 1, 0, 0.92], // 3: first bulwark
  [12, 5, 1, 2, 0.85], // 4: first splitters
  [14, 7, 2, 3, 0.80], // 5: the swarm thickens
  [16, 9, 2, 4, 0.74],
  [18, 11, 3, 5, 0.68],
  [20, 13, 3, 6, 0.62],
  [22, 15, 4, 7, 0.57],
  [24, 18, 5, 8, 0.52], // 10: the long night — hold until dawn
];

export const TOTAL_WAVES = WAVE_TABLE.length;

// Build the spawn queue for a wave: a shuffled list of kinds, so the
// order is never the same twice (the shuffle draws from the seeded RNG).
export function buildWave(wave, rng) {
  const row = WAVE_TABLE[wave - 1];
  const queue = [];
  const kinds = ["wisp", "skitter", "bulwark", "splitter"];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < row[k]; i++) queue.push(kinds[k]);
  }
  // Fisher–Yates with the seeded stream.
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return { queue, interval: row[4], total: queue.length };
}

// Banner text shown when a wave starts. The last one names the stakes.
export function waveBanner(wave) {
  if (wave === 1) return { title: "WAVE 1", sub: "The dark stirs — keep the light alive" };
  if (wave === TOTAL_WAVES) return { title: "WAVE 10 — THE LONG NIGHT", sub: "Hold until dawn. No more dark after this." };
  return { title: `WAVE ${wave}`, sub: "They come faster now" };
}
