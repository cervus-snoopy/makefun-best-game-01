SPDX-License-Identifier: MIT

# VOIDLANTERN — Keeper of the Last Light

[![make.fun](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01)
[![rank](https://make.fun/badge/best-game-01/cervus-snoopy/makefun-best-game-01/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/cervus-snoopy/makefun-best-game-01/reward.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

A 2D neon arena survival game that runs entirely in the browser. You are
the Keeper of the Last Light: night has swallowed the world, and your
lantern is the last light in it. Dark wisps swarm from the edges — shoot
them with bolts of light, gather the embers they drop to refuel your
flame, and survive all 10 waves until dawn. Your light drains a little
every second and a lot with every touch. When it dies, the dark takes you.

Entry for the [best-game-01 bounty](https://make.fun/bounty/best-game-01)
on make.fun ($1,000, top 10 share the prize).

## Play

```
node main.ts --serve            # serve at http://localhost:8080
node main.ts --check            # validate the entry without serving
node main.ts                    # hand the game in: copy game/ + screenshots/
                                # to $MAKEFUN_OUTPUT_DIR (or /output) and write
                                # dossier.json with the kit's buildDossier
```

Open http://localhost:8080, click **LIGHT THE LANTERN**, then play.

| Input | Action |
|---|---|
| W A S D / arrows | Move |
| Mouse | Aim |
| Hold click | Shoot bolts of light |
| Space | Dash (briefly untouchable, shoves enemies aside) |
| P | Pause |
| R | Restart (from pause, game over or victory) |
| M | Mute |
| Enter | Start from the title screen |

HUD: lantern light (top left — the light radius in the world shrinks with
it), wave + combo (top center), score (top right), dash cooldown (bottom
left). Wave banners announce each wave; clearing a wave pays a bonus and
refuels +10 light.

## The dark

| Kind | Look | Behaviour |
|---|---|---|
| Wisp | Violet orb | Slow swarm, drifts toward you with a sine wobble |
| Skitter | Teal dart | Fast zigzag, sidesteps hard in bursts |
| Bulwark | Crimson bulk | Slow, 6 hits, drops 3 embers, hurts the most |
| Splitter | Amber orb | Bursts into 2 wisps when killed |

Kills build a combo (up to x8, kept alive by killing within 3 seconds);
embers magnet to you when close and refuel +5 light each.

## Files

```
main.ts                  Node 22+ entry: serves (--serve), validates (--check),
                         or hands the game in with a dossier (default)
LICENSE                  MIT
README.md                this file
vendor/
  makefun-game.ts        dossier builder (buildDossier) — see note below
game/
  index.html             canvas + HUD + menus, no external references
  main.js                loop, input, states, rendering, combat, auto-player
  engine.js              seeded RNG (mulberry32), math, starfield
  enemies.js             4 enemy kinds + steering AI
  waves.js               10-wave composition table
  audio.js               procedural WebAudio effects (no audio files)
screenshots/
  shot-1.jpg … shot-4.jpg   real headless-Chromium renders of the game's own code
                            (JPEG q85: busy PNG frames run over the 256 KiB
                            per-shot dossier cap)
```

## Rules the build follows

- **Static, no build step.** `game/` is plain HTML + ES modules; no imports
  leave the directory, no CDN, no fetch.
- **No network while playing.** No `fetch`, no `XMLHttpRequest`, no
  `WebSocket`, no `http(s)` URL anywhere in the game sources. Sounds are
  synthesised with WebAudio; all art is drawn on canvas.
- **Deterministic where it matters.** Spawns, wobble, starfield and audio
  noise come from mulberry32 streams with fixed seeds (default seed
  `20261116`). Same seed, same spawns. Player input is the only live
  randomness.
- **The dossier is the judge's view.** The judge never runs the game: it
  reads `dossier.json`, the screenshots first, then the game's source. The
  entry program writes that dossier with `buildDossier`, and the gate
  rebuilds it byte for byte.
- **Original work.** Theme, names, enemy kinds, wave table, sounds and UI
  are all authored for this entry. No third-party code is vendored into
  `game/` at all.

## Vendor file note

`vendor/makefun-game.ts` in this repository is a dossier builder written
for this entry in the documented `makefun/dossier/v1` format, because the
build was done without downloading the best-game kit. Before submit it
must be replaced with the official `vendor/makefun-game.ts` from the
best-game kit, then `node main.ts --check` re-run: `main.ts` imports only
`buildDossier` and `INDEX_HTML` from it, so the swap is one file.

## Verification (local, headless Chromium, 16 Nov 2026)

- `node verify.mjs` (CDP playtest, `best-game-01-verify/verify.mjs`):
  **18/18 PASS** — menu render; real keyboard+mouse input (start, move,
  shoot bolts, dash, P pause/resume); 25 s bot playtest (0 → 18 kills,
  score 0 → 862, wave 1 → 3, light refuel via embers); lethal damage →
  game over; R restarts to wave 1; staged screenshots all live frames;
  **0 console errors, 0 exceptions, 0 failed requests**.
- `node main.ts --check`: **8/8 PASS** (entrypoint, license, game-static,
  game-complete, no-network, screenshots, deterministic, dossier).
- `node main.ts --serve`: serves HTTP 200 at localhost, game loads.
- Hand-in dry run (`MAKEFUN_OUTPUT_DIR=/tmp/vl-out`): exit 0,
  `dossier.json` 259,933 bytes, schema `makefun/dossier/v1`, 4 JPEG
  screenshots, all 6 sources in the dossier text (43,431 bytes, no cut).
  Two hand-in runs produce byte-identical dossiers (sha256 `88f7b207…`).
- Screenshots: 4 real renders, 960×600, JPEG q85 (31–61 KB each, all
  inside the 256 KiB per-shot dossier cap): title, wave 3 mid-fight,
  wave 7 low light, victory.
- Bugs found and fixed during verification: a TypeScript annotation in
  `audio.js` (browser SyntaxError); a `spawnFromQueue` crash on an empty
  queue; PNG screenshots over the dossier cap (→ JPEG); wave-1 banner
  covering the HUD in staged shots (hidden for shots 2–3).
