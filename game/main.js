// main.js — VOIDLANTERN: Keeper of the Last Light.
// A 2D neon arena survival game. You are the Keeper; your lantern's
// light is your life. Dark wisps swarm from the edges — shoot bolts of
// light, gather embers to refuel, survive 10 waves until dawn.
//
// Controls: WASD / arrows move · mouse aims · hold click to shoot ·
// Space dashes (brief invulnerability) · P pauses · R restarts · M mutes.
//
// The game is fully deterministic where it matters: every spawn, wobble
// and star comes from one mulberry32 stream (DEFAULT_SEED). Player input
// is the only live randomness. `?shot=1..4` holds four staged views for
// screenshots; `window.__voidlantern` exposes state for play-testing.

import { mulberry32, clamp, dist2, angleTo, edgePoint, makeStars, TAU } from "./engine.js";
import { ENEMY_TYPES, spawnEnemy, steerEnemy } from "./enemies.js";
import { buildWave, waveBanner, TOTAL_WAVES } from "./waves.js";
import { ensureAudio, setMuted, isMuted, sfx } from "./audio.js";

export const DEFAULT_SEED = 20261116;
export const W = 960;
export const H = 600;

const LIGHT_MAX = 100;
const LIGHT_DRAIN = 0.25; // light lost per second, so standing still loses
const EMBER_LIGHT = 5;
const WAVE_CLEAR_LIGHT = 10;
const COMBO_WINDOW = 3; // seconds between kills to keep the combo alive
const COMBO_MAX = 8;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---- DOM (HUD + menus) ----
const $ = (id) => document.getElementById(id);
const hud = $("hud");
const lightFill = $("lightFill");
const lightText = $("lightText");
const scoreText = $("scoreText");
const waveText = $("waveText");
const comboText = $("comboText");
const dashFill = $("dashFill");
const banner = $("banner");
const bannerTitle = $("bannerTitle");
const bannerSub = $("bannerSub");
const menuEl = $("menu");
const pauseEl = $("pause");
const overEl = $("over");
const winEl = $("win");
const finalScore = $("finalScore");
const finalWave = $("finalWave");
const winScore = $("winScore");
const winKills = $("winKills");
const muteBtn = $("muteBtn");

// ---- State ----
let rng = mulberry32(DEFAULT_SEED);
let state = "menu"; // menu | playing | paused | over | win
let time = 0; // match clock, seconds
let player, bolts, enemies, embers, particles, floaters;
let score = 0, kills = 0, wave = 0, combo = 0, comboTimer = 0;
let waveQueue = [], spawnTimer = 0, spawnInterval = 1;
let betweenWaves = 0;
let shake = 0;
let stars = makeStars(mulberry32(DEFAULT_SEED + 7), W, H, 110);
let autoPlay = false; // bot driver for screenshots + playability proof
let lastTs = 0;

const keys = {};
let mouse = { x: W / 2, y: H / 2 - 120, down: false };

function resetMatch(seed) {
  rng = mulberry32(seed);
  time = 0;
  score = 0; kills = 0; wave = 0; combo = 0; comboTimer = 0;
  waveQueue = []; spawnTimer = 0; betweenWaves = 0; shake = 0;
  bolts = []; enemies = []; embers = []; particles = []; floaters = [];
  player = {
    x: W / 2, y: H / 2, r: 14,
    light: LIGHT_MAX,
    aim: -Math.PI / 2,
    fireCd: 0, dashCd: 0, dashTime: 0, invuln: 0,
    moving: false,
  };
}

function showOnly(el) {
  for (const m of [menuEl, pauseEl, overEl, winEl]) m.classList.add("hidden");
  if (el) el.classList.remove("hidden");
  hud.classList.toggle("on", state === "playing" || state === "paused");
}

function flashBanner(title, sub, ms) {
  bannerTitle.textContent = title;
  bannerSub.textContent = sub;
  banner.classList.remove("hidden");
  banner.classList.add("show");
  clearTimeout(flashBanner._t);
  flashBanner._t = setTimeout(() => banner.classList.add("hidden"), ms);
}

function startWave(n) {
  wave = n;
  const built = buildWave(n, rng);
  waveQueue = built.queue;
  spawnInterval = built.interval;
  spawnTimer = 0.6;
  const b = waveBanner(n);
  flashBanner(b.title, b.sub, 2200);
  sfx.wave();
}

function startMatch() {
  ensureAudio();
  resetMatch(DEFAULT_SEED);
  state = "playing";
  showOnly(null);
  startWave(1);
}

function endMatch(won) {
  state = won ? "win" : "over";
  if (won) {
    sfx.win();
    winScore.textContent = score.toLocaleString("en-US");
    winKills.textContent = kills;
    showOnly(winEl);
  } else {
    sfx.lose();
    finalScore.textContent = score.toLocaleString("en-US");
    finalWave.textContent = wave;
    showOnly(overEl);
  }
}

// ---- Spawning, pickups, particles ----
function spawnFromQueue() {
  if (waveQueue.length === 0) return; // staging or a cleared wave: never spawn undefined
  const kind = waveQueue.shift();
  const p = edgePoint(rng, W, H, player.x, player.y, 180);
  enemies.push(spawnEnemy(kind, p.x, p.y, rng));
}

function dropEmbers(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU;
    embers.push({
      x, y,
      vx: Math.cos(a) * (30 + rng() * 60),
      vy: Math.sin(a) * (30 + rng() * 60),
      r: 6, t: 0, life: 14,
      magnet: false,
    });
  }
}

function burst(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU;
    const s = speed * (0.3 + rng() * 0.7);
    particles.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 1.5 + rng() * 2.5, color,
      t: 0, life: 0.4 + rng() * 0.5,
    });
  }
}

function floater(x, y, text, color) {
  floaters.push({ x, y, text, color, t: 0, life: 0.9 });
}

function addScore(base, x, y) {
  const mult = 1 + (combo - 1) * 0.25; // combo x1 .. x2.75
  const gained = Math.round(base * mult);
  score += gained;
  floater(x, y, `+${gained}`, "#ffe9a8");
}

// ---- Combat ----
function fireBolt() {
  const a = player.aim;
  const bx = player.x + Math.cos(a) * (player.r + 8);
  const by = player.y + Math.sin(a) * (player.r + 8);
  bolts.push({
    x: bx, y: by,
    vx: Math.cos(a) * 520, vy: Math.sin(a) * 520,
    r: 5, life: 1.1,
  });
  player.fireCd = 0.125;
  burst(bx, by, "#ffd76a", 3, 60);
  sfx.shoot();
}

function hurtPlayer(amount, x, y) {
  if (player.invuln > 0 || state !== "playing") return;
  player.light -= amount;
  player.invuln = 0.6;
  shake = Math.max(shake, 7);
  burst(player.x, player.y, "#ff5d73", 14, 180);
  floater(player.x, player.y - 24, `-${amount} light`, "#ff8ba0");
  sfx.hurt();
  if (player.light <= 0) {
    player.light = 0;
    burst(player.x, player.y, "#ffd76a", 40, 260);
    endMatch(false);
  }
}

function killEnemy(e, idx) {
  enemies.splice(idx, 1);
  kills++;
  combo = Math.min(combo + 1, COMBO_MAX);
  comboTimer = COMBO_WINDOW;
  addScore(e.def.score, e.x, e.y);
  burst(e.x, e.y, e.def.color, e.kind === "bulwark" ? 26 : 14, 200);
  dropEmbers(e.x, e.y, e.def.embers);
  sfx.kill();
  if (e.def.splitsInto) {
    for (let i = 0; i < e.def.splitCount; i++) {
      const a = rng() * TAU;
      const child = spawnEnemy(
        e.def.splitsInto,
        e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18, rng,
      );
      child.enter = 0;
      enemies.push(child);
    }
  }
}

// ---- Update ----
function update(dt) {
  time += dt;
  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) combo = 0;
  }
  if (shake > 0) shake = Math.max(0, shake - dt * 30);

  // Passive drain: the night always eats a little light.
  player.light -= LIGHT_DRAIN * dt;
  if (player.light <= 0) { player.light = 0; burst(player.x, player.y, "#ffd76a", 40, 260); endMatch(false); return; }

  // --- player movement ---
  let mx = 0, my = 0;
  if (keys["arrowup"] || keys["w"]) my -= 1;
  if (keys["arrowdown"] || keys["s"]) my += 1;
  if (keys["arrowleft"] || keys["a"]) mx -= 1;
  if (keys["arrowright"] || keys["d"]) mx += 1;
  const ml = Math.hypot(mx, my);
  if (ml > 0) { mx /= ml; my /= ml; }
  const speed = player.dashTime > 0 ? 640 : 245;
  player.x = clamp(player.x + mx * speed * dt, 20, W - 20);
  player.y = clamp(player.y + my * speed * dt, 20, H - 20);
  player.moving = ml > 0;
  player.aim = angleTo(player.x, player.y, mouse.x, mouse.y);
  if (player.dashTime > 0) player.dashTime -= dt;
  if (player.dashCd > 0) player.dashCd -= dt;
  if (player.invuln > 0) player.invuln -= dt;
  if (player.fireCd > 0) player.fireCd -= dt;
  if (mouse.down && player.fireCd <= 0) fireBolt();

  // --- spawning ---
  if (waveQueue.length > 0) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnFromQueue();
      spawnTimer = spawnInterval;
    }
  } else if (enemies.length === 0) {
    // Wave cleared.
    if (wave >= TOTAL_WAVES) { endMatch(true); return; }
    betweenWaves += dt;
    if (betweenWaves === dt) {
      const bonus = 100 * wave;
      score += bonus;
      player.light = Math.min(LIGHT_MAX, player.light + WAVE_CLEAR_LIGHT);
      floater(player.x, player.y - 30, `WAVE CLEAR +${bonus}`, "#8fffcf");
      sfx.ember();
    }
    if (betweenWaves > 2.2) {
      betweenWaves = 0;
      startWave(wave + 1);
    }
  }

  // --- enemies ---
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    steerEnemy(e, player.x, player.y, dt, time, rng);
    if (dist2(e.x, e.y, player.x, player.y) < (e.radius + player.r) * (e.radius + player.r)) {
      if (player.dashTime > 0) {
        // Dashing through an enemy shoves it away and staggers it.
        const a = angleTo(player.x, player.y, e.x, e.y);
        e.x += Math.cos(a) * 26; e.y += Math.sin(a) * 26;
        e.enter = Math.max(e.enter, 0.25);
      } else {
        hurtPlayer(e.def.touch, e.x, e.y);
        // The enemy recoils so one touch is one hit, not a drain.
        const a = angleTo(player.x, player.y, e.x, e.y);
        e.x += Math.cos(a) * 30; e.y += Math.sin(a) * 30;
        e.enter = Math.max(e.enter, 0.4);
      }
    }
  }

  // --- bolts ---
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
      bolts.splice(i, 1); continue;
    }
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (e.enter > 0) continue;
      if (dist2(b.x, b.y, e.x, e.y) < (b.r + e.radius) * (b.r + e.radius)) {
        bolts.splice(i, 1);
        e.hp -= 1;
        e.flash = 1;
        burst(b.x, b.y, e.def.color, 5, 120);
        sfx.hit();
        if (e.hp <= 0) killEnemy(e, j);
        break;
      }
    }
  }

  // --- embers: drift, then magnet to the Keeper when close ---
  for (let i = embers.length - 1; i >= 0; i--) {
    const em = embers[i];
    em.t += dt; em.life -= dt;
    const d = Math.hypot(player.x - em.x, player.y - em.y);
    if (d < 110) {
      const a = angleTo(em.x, em.y, player.x, player.y);
      em.vx = Math.cos(a) * 260; em.vy = Math.sin(a) * 260;
    } else {
      em.vx *= (1 - dt * 2); em.vy *= (1 - dt * 2);
    }
    em.x += em.vx * dt; em.y += em.vy * dt;
    if (em.life <= 0) { embers.splice(i, 1); continue; }
    if (d < player.r + 12) {
      embers.splice(i, 1);
      player.light = Math.min(LIGHT_MAX, player.light + EMBER_LIGHT);
      addScore(5, em.x, em.y);
      burst(em.x, em.y, "#ffd76a", 6, 90);
      sfx.ember();
    }
  }

  // --- particles + floaters ---
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= (1 - dt * 2.4); p.vy *= (1 - dt * 2.4);
    if (p.t >= p.life) particles.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt; f.y -= 34 * dt;
    if (f.t >= f.life) floaters.splice(i, 1);
  }

  // --- auto-player (screenshots + playability proof) ---
  if (autoPlay) driveBot(dt);
}

// Simple bot: kite away from the nearest enemy, drift toward the nearest
// ember, aim at the nearest enemy and hold fire. Good enough to survive
// the early waves and to stage lively screenshots.
function driveBot(dt) {
  if (enemies.length === 0 && embers.length === 0) {
    keys["w"] = false; keys["a"] = false; keys["s"] = false; keys["d"] = false;
    mouse.down = false;
    return;
  }
  let tx = player.x, ty = player.y;
  let nearest = null, nd = Infinity;
  for (const e of enemies) {
    const d = dist2(e.x, e.y, player.x, player.y);
    if (d < nd) { nd = d; nearest = e; }
  }
  if (embers.length > 0 && (!nearest || nd > 140 * 140)) {
    let be = null, bd = Infinity;
    for (const em of embers) {
      const d = dist2(em.x, em.y, player.x, player.y);
      if (d < bd) { bd = d; be = em; }
    }
    tx = be.x; ty = be.y;
  } else if (nearest) {
    // Flee radially, but stay inside the arena.
    const a = angleTo(nearest.x, nearest.y, player.x, player.y);
    tx = player.x + Math.cos(a) * 120;
    ty = player.y + Math.sin(a) * 120;
    tx = clamp(tx, 40, W - 40); ty = clamp(ty, 40, H - 40);
    mouse.x = nearest.x; mouse.y = nearest.y;
    mouse.down = true;
  }
  const dx = tx - player.x, dy = ty - player.y;
  keys["w"] = dy < -12; keys["s"] = dy > 12;
  keys["a"] = dx < -12; keys["d"] = dx > 12;
  if (nearest) { mouse.x = nearest.x; mouse.y = nearest.y; mouse.down = true; }
  // Dash away when something gets too close.
  if (nearest && nd < 55 * 55 && player.dashCd <= 0) doDash();
}

function doDash() {
  if (player.dashCd > 0 || state !== "playing") return;
  player.dashCd = 0.9;
  player.dashTime = 0.16;
  player.invuln = Math.max(player.invuln, 0.35);
  burst(player.x, player.y, "#8fffcf", 10, 140);
  sfx.dash();
}

// ---- Rendering ----
function draw() {
  ctx.save();
  if (shake > 0) {
    ctx.translate((rng() - 0.5) * shake, (rng() - 0.5) * shake);
  }
  // Background: deep indigo gradient.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b0b26");
  bg.addColorStop(0.55, "#12123a");
  bg.addColorStop(1, "#0a0a20");
  ctx.fillStyle = bg;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  // Stars.
  for (const s of stars) {
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(time * s.speed + s.phase));
    ctx.globalAlpha = tw * 0.8;
    ctx.fillStyle = s.warm ? "#ffd9a0" : "#cfe4ff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Arena edge: a faint ring the Keeper must stay inside.
  ctx.strokeStyle = "rgba(140, 160, 255, 0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, W - 28, H - 28);

  if (state === "playing" || state === "paused") {
    // Lantern glow: the light radius IS the health bar in the world.
    const glowR = 110 + player.light * 1.7;
    const glow = ctx.createRadialGradient(player.x, player.y, 10, player.x, player.y, glowR);
    glow.addColorStop(0, "rgba(255, 205, 90, 0.34)");
    glow.addColorStop(0.5, "rgba(255, 170, 60, 0.12)");
    glow.addColorStop(1, "rgba(255, 170, 60, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(player.x - glowR, player.y - glowR, glowR * 2, glowR * 2);

    // Embers.
    for (const em of embers) {
      const pulse = 0.7 + 0.3 * Math.sin(em.t * 6);
      ctx.save();
      ctx.shadowColor = "#ffb347"; ctx.shadowBlur = 12;
      ctx.fillStyle = "#ffd76a";
      ctx.globalAlpha = clamp(em.life, 0, 1) * pulse;
      ctx.beginPath();
      ctx.arc(em.x, em.y, em.r, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Enemies.
    for (const e of enemies) {
      const alpha = e.enter > 0 ? 0.45 + 0.55 * (1 - e.enter / 0.45) : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = e.def.color; ctx.shadowBlur = 16;
      ctx.fillStyle = e.flash > 0 ? "#ffffff" : e.def.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = e.def.core;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 0.42, 0, TAU);
      ctx.fill();
      // Eyes: two dots that face the Keeper, so they feel alive.
      const a = angleTo(e.x, e.y, player.x, player.y);
      ctx.fillStyle = "#0b0b26";
      for (const off of [-0.35, 0.35]) {
        const ex = e.x + Math.cos(a + off) * e.radius * 0.45;
        const ey = e.y + Math.sin(a + off) * e.radius * 0.45;
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(2, e.radius * 0.12), 0, TAU);
        ctx.fill();
      }
      // Bulwark health arc.
      if (e.maxHp > 1) {
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 6, -Math.PI / 2, -Math.PI / 2 + TAU * (e.hp / e.maxHp));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Bolts.
    for (const b of bolts) {
      ctx.save();
      ctx.shadowColor = "#ffd76a"; ctx.shadowBlur = 10;
      ctx.strokeStyle = "#ffe9a8";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }

    // Particles.
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // The Keeper: a lantern — brass ring, glowing core, little legs of
    // light. The aim line is short and subtle, not a laser.
    ctx.save();
    if (player.invuln > 0 && Math.floor(time * 14) % 2 === 0) ctx.globalAlpha = 0.45;
    ctx.shadowColor = "#ffd76a"; ctx.shadowBlur = 22;
    ctx.fillStyle = "#ffb347";
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r + 3, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff3c4";
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r - 3, 0, TAU);
    ctx.fill();
    // Lantern cap + handle.
    ctx.fillStyle = "#8a5a1d";
    ctx.fillRect(player.x - 6, player.y - player.r - 7, 12, 5);
    ctx.strokeStyle = "#8a5a1d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y - player.r - 4, 7, Math.PI, 0);
    ctx.stroke();
    // Aim tick.
    ctx.strokeStyle = "rgba(255, 233, 168, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x + Math.cos(player.aim) * (player.r + 6), player.y + Math.sin(player.aim) * (player.r + 6));
    ctx.lineTo(player.x + Math.cos(player.aim) * (player.r + 16), player.y + Math.sin(player.aim) * (player.r + 16));
    ctx.stroke();
    ctx.restore();

    // Floating score text.
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.globalAlpha = 1 - f.t / f.life;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // Vignette: the dark closes in as the light drains.
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
  const dark = state === "playing" ? clamp(0.55 - player.light / 260, 0.15, 0.55) : 0.45;
  vig.addColorStop(0, "rgba(5,5,18,0)");
  vig.addColorStop(1, `rgba(5,5,18,${dark})`);
  ctx.fillStyle = vig;
  ctx.fillRect(-20, -20, W + 40, H + 40);
  ctx.restore();
}

function updateHud() {
  if (state !== "playing" && state !== "paused") return;
  lightFill.style.width = `${player.light}%`;
  lightFill.classList.toggle("low", player.light < 30);
  lightText.textContent = `${Math.ceil(player.light)}`;
  scoreText.textContent = score.toLocaleString("en-US");
  waveText.textContent = `${wave} / ${TOTAL_WAVES}`;
  comboText.textContent = combo > 1 ? `COMBO x${combo}` : "";
  dashFill.style.width = `${clamp(1 - player.dashCd / 0.9, 0, 1) * 100}%`;
}

// ---- Main loop ----
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  if (state === "playing") update(dt);
  draw();
  updateHud();
}

// ---- Input ----
function keyOf(e) { return e.key.toLowerCase(); }

window.addEventListener("keydown", (e) => {
  const k = keyOf(e);
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  keys[k] = true;
  ensureAudio();
  if (k === " " && state === "playing") doDash();
  if (k === "p" && (state === "playing" || state === "paused")) {
    state = state === "playing" ? "paused" : "playing";
    showOnly(state === "paused" ? pauseEl : null);
  }
  if (k === "r" && (state === "over" || state === "win" || state === "paused")) startMatch();
  if (k === "m") setMuted(!isMuted());
  if (k === "enter" && state === "menu") startMatch();
});
window.addEventListener("keyup", (e) => { keys[keyOf(e)] = false; });

function mousePos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * W,
    y: ((e.clientY - r.top) / r.height) * H,
  };
}
canvas.addEventListener("mousemove", (e) => { mouse = mousePos(e); });
canvas.addEventListener("mousedown", (e) => {
  ensureAudio();
  mouse = mousePos(e);
  mouse.down = true;
  if (state === "menu") startMatch();
});
window.addEventListener("mouseup", () => { mouse.down = false; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

$("startBtn").addEventListener("click", startMatch);
$("resumeBtn").addEventListener("click", () => { state = "playing"; showOnly(null); });
$("retryBtn").addEventListener("click", startMatch);
$("againBtn").addEventListener("click", startMatch);
muteBtn.addEventListener("click", () => {
  ensureAudio();
  setMuted(!isMuted());
  muteBtn.textContent = isMuted() ? "SOUND: OFF" : "SOUND: ON";
});

// ---- Screenshot staging (?shot=1..4) ----
// Deterministic staged views so the screenshots show the real game:
// 1 = title menu, 2 = wave 3 mid-fight, 3 = wave 7, low light, heavy
// swarm, 4 = victory screen. Shots 2–3 run the auto-player so the frame
// is a live fight, not a posed still.
function stageShot(n) {
  if (n === 1) { state = "menu"; showOnly(menuEl); return; }
  if (n === 4) {
    resetMatch(DEFAULT_SEED);
    score = 8430; kills = 187; wave = TOTAL_WAVES;
    state = "win";
    winScore.textContent = score.toLocaleString("en-US");
    winKills.textContent = kills;
    showOnly(winEl);
    return;
  }
  startMatch();
  autoPlay = true;
  if (n === 2) {
    // Jump to wave 3 with a fight already in progress.
    wave = 3;
    const built = buildWave(3, rng);
    waveQueue = built.queue.slice(4);
    spawnInterval = built.interval;
    for (let i = 0; i < 14; i++) spawnFromQueue();
    for (let i = 0; i < 4; i++) dropEmbers(W / 2 + (rng() - 0.5) * 300, H / 2 + (rng() - 0.5) * 200, 1);
    player.light = 82;
    score = 1240; kills = 41; combo = 4; comboTimer = 2;
  } else if (n === 3) {
    // Wave 7, light nearly out: the dramatic frame.
    wave = 7;
    const built = buildWave(7, rng);
    waveQueue = built.queue.slice(10);
    spawnInterval = built.interval;
    for (let i = 0; i < 16; i++) spawnFromQueue();
    player.light = 18;
    player.x = W * 0.32; player.y = H * 0.62;
    score = 5210; kills = 132; combo = 6; comboTimer = 2.4;
  }
  // Staged shots start from startMatch, whose wave-1 banner would still
  // be on screen at capture time and cover the HUD — hide it: the shot
  // is a mid-fight frame, not a wave opening.
  if (n === 2 || n === 3) {
    clearTimeout(flashBanner._t);
    banner.classList.add("hidden");
    banner.classList.remove("show");
  }
}

// ---- Boot ----
resetMatch(DEFAULT_SEED);
showOnly(menuEl);
const shot = new URLSearchParams(location.search).get("shot");
if (shot) stageShot(parseInt(shot, 10));
requestAnimationFrame(frame);

// Test handle: state for automated play-testing. Nothing here affects
// normal play; the verifier drives the game through it.
window.__voidlantern = {
  get state() { return state; },
  get score() { return score; },
  get wave() { return wave; },
  get light() { return player ? player.light : 0; },
  get kills() { return kills; },
  get enemies() { return enemies.length; },
  get bolts() { return bolts.length; },
  get embers() { return embers.length; },
  get combo() { return combo; },
  start: () => startMatch(),
  damage: (n) => hurtPlayer(n, player.x, player.y),
  // Staging hook for screenshots: set the lantern light directly so a
  // staged frame can show the genuine low-light state (red bar, small
  // glow radius) the game itself renders.
  setLight: (n) => { player.light = clamp(n, 0, LIGHT_MAX); },
  setAuto: (v) => { autoPlay = v; },
  keys,
  mouse,
};
