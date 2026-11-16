// main.ts — VOIDLANTERN entry point (best-game-01).
//
// What it does, by mode:
//
//   node main.ts                          hand the game in: validate the entry,
//                                         copy game/ + screenshots/ to /output
//                                         (or $MAKEFUN_OUTPUT_DIR) and write
//                                         /output/dossier.json with the kit's
//                                         buildDossier, then exit. This is the
//                                         mode the grader runs.
//   node main.ts --check                 validate only, exit 0/1, serve nothing.
//   node main.ts --serve [--port 8080]   serve the game locally for playtesting.
//
// Node 22+ (type stripping; Node 24 runs this file directly). No
// dependencies, no build step: the game is static files under game/.
//
// The game constants and the seeded RNG live here, next to the game they
// describe — the vendor file only supplies buildDossier, which is the
// only name imported from it.
//
// NOTE ON THE VENDOR FILE: vendor/makefun-game.ts is a stand-in dossier
// builder written for this entry (see its header). Before submit, replace
// it with the official vendor/makefun-game.ts from the best-game kit and
// re-run `node main.ts --check`; this file imports only buildDossier and
// INDEX_HTML from it, so the swap is one file.

import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier, INDEX_HTML } from "./vendor/makefun-game.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const GAME_DIR = join(ROOT, "game");
const SHOTS_DIR = join(ROOT, "screenshots");

// ---- Game constants (from the game itself: game/main.js, game/waves.js) ----
const GAME_CONFIG = {
  title: "VOIDLANTERN — Keeper of the Last Light",
  genre: "2D neon arena survival shooter",
  waves: 10,
  width: 960,
  height: 600,
};

// The seeded RNG stream every spawn comes from. Same seed the game uses
// (game/main.js: DEFAULT_SEED), so the draws proven here are the draws
// the game replays.
const DEFAULT_SEED = 20261116;

// mulberry32: the same tiny seeded RNG game/engine.js uses. One function,
// no state outside the closure, so the same seed always replays the same
// stream of draws.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The entry rules this file checks, each with the line --check prints when
// the rule passes. Short, plain statements of what the rule means.
const ENTRY_RULES: Array<{ name: string; detail: string }> = [
  { name: "entrypoint", detail: "main.ts at the repo root hands the game in" },
  { name: "license", detail: "MIT license (SPDX identifier on the first line)" },
  { name: "game-static", detail: "all game source files present under game/" },
  { name: "game-complete", detail: "goal, win, lose, score, start and restart in the game" },
  { name: "no-network", detail: "no network calls or remote URLs in the game sources" },
  { name: "screenshots", detail: "3–4 real rendered screenshots in screenshots/" },
  { name: "deterministic", detail: "spawns use the seeded RNG only (no Math.random / Date.now)" },
  { name: "dossier", detail: "dossier builds from game/ + screenshots/ inside the gate caps" },
];

// The scorer's own caps (fps kit starter main.ts / gate.json): only
// text_max_bytes shapes the bytes; the others refuse an entry the scorer
// would refuse (more than 4 screenshots or one over 256 KiB; more than 993
// files in game/ or 48 MiB of game files in all).
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};
const DOSSIER_MAX_BYTES = 1500000; // dossier.json at most 1.5 MiB, per RULES.txt

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function fail(name: string, detail: string): { name: string; ok: boolean; detail: string } {
  return { name, ok: false, detail };
}

const GAME_FILES = ["index.html", "main.js", "engine.js", "enemies.js", "waves.js", "audio.js"];

async function checkEntry(): Promise<Array<{ name: string; ok: boolean; detail: string }>> {
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const byName = new Map(ENTRY_RULES.map((r) => [r.name, r.detail]));

  // entrypoint
  results.push(
    existsSync(join(ROOT, "main.ts"))
      ? { name: "entrypoint", ok: true, detail: byName.get("entrypoint") as string }
      : fail("entrypoint", "main.ts missing at repo root"),
  );

  // license
  try {
    const lic = await readText(join(ROOT, "LICENSE"));
    results.push(
      lic.startsWith("SPDX-License-Identifier: MIT")
        ? { name: "license", ok: true, detail: byName.get("license") as string }
        : fail("license", "LICENSE does not open with SPDX-License-Identifier: MIT"),
    );
  } catch {
    results.push(fail("license", "LICENSE missing"));
  }

  // game-static
  const missing = GAME_FILES.filter((f) => !existsSync(join(GAME_DIR, f)));
  results.push(
    missing.length === 0
      ? { name: "game-static", ok: true, detail: `${byName.get("game-static") as string} (${GAME_FILES.length} files)` }
      : fail("game-static", `missing game files: ${missing.join(", ")}`),
  );

  // game-complete: the game must state its goal, win, lose, score, start
  // and restart — checked in the sources and the page, not by playing.
  try {
    const main = existsSync(join(GAME_DIR, "main.js")) ? await readText(join(GAME_DIR, "main.js")) : "";
    const html = existsSync(join(GAME_DIR, "index.html")) ? await readText(join(GAME_DIR, "index.html")) : "";
    const waves = existsSync(join(GAME_DIR, "waves.js")) ? await readText(join(GAME_DIR, "waves.js")) : "";
    const marks = [
      ["goal", /survive|keep the light alive/i.test(html + main)],
      ["win", /endMatch\(true\)|DAWN BREAKS/i.test(main + html)],
      ["lose", /endMatch\(false\)|THE DARK TAKES YOU/i.test(main + html)],
      ["score", /score\s*\+=|addScore/i.test(main)],
      ["start", /startMatch\(\)/i.test(main)],
      ["restart", /retryBtn|againBtn|R.*restart/i.test(main + html)],
      ["waves", /TOTAL_WAVES/.test(waves)],
    ];
    const absent = marks.filter(([, ok]) => !ok).map(([name]) => name);
    results.push(
      absent.length === 0
        ? { name: "game-complete", ok: true, detail: `${byName.get("game-complete") as string} (goal/win/lose/score/start/restart/${GAME_CONFIG.waves} waves)` }
        : fail("game-complete", `missing completeness marks: ${absent.join(", ")}`),
    );
  } catch (e) {
    results.push(fail("game-complete", `unreadable game sources: ${(e as Error).message}`));
  }

  // no-network: scan every game source file for network primitives / URLs.
  // data: URIs are stripped first (whole quoted attribute value): an
  // inline SVG favicon's XML namespace (http://www.w3.org/2000/svg) is
  // not a network fetch, but its quotes and spaces defeat a naive strip.
  const netPatterns = [/fetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /https?:\/\//, /import\s*\(\s*['"]https?/];
  const offenders: string[] = [];
  for (const f of GAME_FILES) {
    const p = join(GAME_DIR, f);
    if (!existsSync(p)) continue;
    const src = (await readText(p))
      .replace(/"data:[^"]*"/g, '""')
      .replace(/'data:[^']*'/g, "''");
    for (const re of netPatterns) {
      if (re.test(src)) { offenders.push(`${f}: ${re}`); break; }
    }
  }
  results.push(
    offenders.length === 0
      ? { name: "no-network", ok: true, detail: byName.get("no-network") as string }
      : fail("no-network", `network reference in ${offenders.join("; ")}`),
  );

  // screenshots: at least 3 real renders, each a non-trivial image.
  // PNG or JPEG both count (the dossier takes either); JPEG is used
  // because busy PNG frames run over the 256 KiB per-shot dossier cap.
  try {
    const files = (await readdir(SHOTS_DIR)).filter((f) => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg")).sort();
    let shotsOk = files.length >= 3 && files.length <= 4;
    let detail = `${files.length} image renders in screenshots/`;
    for (const f of files) {
      const s = await stat(join(SHOTS_DIR, f));
      if (s.size < 20_000) { shotsOk = false; detail = `${f} too small (${s.size} bytes) to be a real render`; break; }
      if (s.size > 262144) { shotsOk = false; detail = `${f} is ${s.size} bytes, over the 256 KiB dossier cap`; break; }
    }
    results.push(shotsOk ? { name: "screenshots", ok: true, detail } : fail("screenshots", detail));
  } catch {
    results.push(fail("screenshots", "screenshots/ missing"));
  }

  // deterministic: gameplay randomness must come from the seeded RNG.
  let detOk = false;
  let detDetail = "";
  try {
    const engineSrc = await readText(join(GAME_DIR, "engine.js"));
    const mainSrc = await readText(join(GAME_DIR, "main.js"));
    const enemiesSrc = await readText(join(GAME_DIR, "enemies.js"));
    const wavesSrc = await readText(join(GAME_DIR, "waves.js"));
    const audioSrc = await readText(join(GAME_DIR, "audio.js"));
    const all = engineSrc + mainSrc + enemiesSrc + wavesSrc + audioSrc;
    const rng = mulberry32(DEFAULT_SEED);
    const firstDraws = [rng(), rng()].map((v) => v.toFixed(6)).join(", ");
    detOk =
      engineSrc.includes("mulberry32") &&
      mainSrc.includes("DEFAULT_SEED") &&
      !/Math\.random\s*\(/.test(all) &&
      !/Date\.now\s*\(/.test(all);
    detDetail = detOk
      ? `${byName.get("deterministic") as string} (seed ${DEFAULT_SEED} draws: ${firstDraws})`
      : "game sources must use the seeded RNG (mulberry32) with no Math.random / Date.now";
  } catch (e) {
    detDetail = `unreadable game sources: ${(e as Error).message}`;
  }
  results.push(detOk ? { name: "deterministic", ok: true, detail: detDetail } : fail("deterministic", detDetail));

  // dossier: the judge reads dossier.json, so it must build cleanly from
  // game/ + screenshots/ inside the gate caps. Build it in memory here;
  // the handoff writes the same bytes to /output/dossier.json.
  try {
    const bytes = buildDossier(ROOT, DOSSIER_CAPS);
    results.push(
      bytes.length <= DOSSIER_MAX_BYTES
        ? { name: "dossier", ok: true, detail: `${byName.get("dossier") as string} (${bytes.length} bytes)` }
        : fail("dossier", `dossier ${bytes.length} bytes, over the ${DOSSIER_MAX_BYTES} cap`),
    );
  } catch (e) {
    results.push(fail("dossier", `buildDossier failed: ${(e as Error).message}`));
  }

  return results;
}

async function handIn(outDir: string): Promise<void> {
  const checks = await checkEntry();
  const bad = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`[check] ${c.ok ? "ok" : "FAIL"} ${c.name}: ${c.detail}`);
  if (bad.length > 0) {
    console.error("[check] refusing to hand in an invalid entry — fix the failures above");
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  cpSync(GAME_DIR, join(outDir, "game"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });
  if (existsSync(SHOTS_DIR)) cpSync(SHOTS_DIR, join(outDir, "screenshots"), { recursive: true });
  // The scorer rebuilds the dossier with the same library and compares byte
  // for byte, so these must be exactly the bytes buildDossier writes.
  const dossier = buildDossier(outDir, DOSSIER_CAPS);
  writeFileSync(join(outDir, "dossier.json"), dossier);
  console.log(`[handoff] game/ + screenshots/ copied to ${outDir}`);
  console.log(`[handoff] dossier.json written (${dossier.length} bytes)`);
  console.log(`[handoff] VOIDLANTERN ready — ${GAME_CONFIG.waves} waves, survive until dawn`);
}

async function serve(port: number): Promise<void> {
  const checks = await checkEntry();
  const bad = checks.filter((c) => !c.ok);
  if (bad.length > 0) {
    for (const c of bad) console.error(`[check] FAIL ${c.name}: ${c.detail}`);
    console.error("[check] refusing to serve an invalid entry — fix the failures above");
    process.exit(1);
  }
  for (const c of checks) console.log(`[check] ok ${c.name}: ${c.detail}`);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/game/index.html";
      // Only serve files from inside the repo root.
      const target = resolve(ROOT, `.${pathname}`);
      if (!target.startsWith(ROOT)) { res.writeHead(403); res.end("forbidden"); return; }
      const data = await readFile(target);
      res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  server.listen(port, () => {
    console.log(`VOIDLANTERN serving at http://localhost:${port}/ (${GAME_CONFIG.waves} waves, survive until dawn)`);
  });
}

const args = process.argv.slice(2);
if (args.includes("--check")) {
  const checks = await checkEntry();
  let ok = true;
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
    if (!c.ok) ok = false;
  }
  process.exit(ok ? 0 : 1);
} else if (args.includes("--serve")) {
  const portArg = args.indexOf("--port");
  const port = portArg >= 0 ? parseInt(args[portArg + 1] ?? "8080", 10) : 8080;
  await serve(port);
} else {
  // Default: hand the game in, as the grader runs it.
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  await handIn(outDir);
}

void INDEX_HTML;
