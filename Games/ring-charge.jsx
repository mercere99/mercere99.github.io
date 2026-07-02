import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

/* ============================================================
   RING CHARGE — hex-map ring-merging puzzle
   ============================================================ */
const HEX = 46;                 // hex circumradius (board units)
const POINTS_PER_DOT = 5;
const MAX_RINGS = 5;            // ring slots per hex (also capped by palette size)
const MIN_TILE_DOTS = 2, MAX_TILE_DOTS = 7, MAX_RING_DOTS = 5;

/* Ring slots are anchored to the OUTSIDE: the outermost ring of any tile
   always sits in the largest slot; inner rings fill inward from there.
   Slot radii must fit the hex inradius (HEX*sqrt(3)/2 ~ 39.8). */
const RING_BASE = 8.5, RING_STEP = 6.6;
const slotRad = (s) => RING_BASE + s * RING_STEP;
const RING_W_IN = 4.6, RING_W_OUT = 7.0;   // outermost ring is thicker
const DOT_R_IN = 2.05, DOT_R_OUT = 2.9;    // ...so its dots can be bigger

/* Motion knobs */
const FLIGHT_MS = 540, FLIGHT_STAGGER = 55;      // ring-to-ring merges
const BAR_FLIGHT_MS = 680, BAR_STAGGER = 65;     // pops flying to score bar / locks
const BROWNIAN = 1.9, SPRING = 2.2, DRAG = 1.7;  // dot drift
const HAND_SIZE = 34;
const BAR_H = 13;

const PALETTE = [
  { name: "crimson", ring: "#ff3355", glow: "#ffaebc" },
  { name: "amber",   ring: "#ffb300", glow: "#ffe38a" },
  { name: "emerald", ring: "#00e676", glow: "#a9ffd4" },
  { name: "blue",    ring: "#2f7bff", glow: "#aac9ff" },
  { name: "violet",  ring: "#b44cff", glow: "#e4c6ff" },
  { name: "pearl",   ring: "#e8edf9", glow: "#ffffff" },
  { name: "magenta", ring: "#ff4fd8", glow: "#ffc0f0" },
];

const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const keyOf = (q, r) => `${q},${r}`;
const parseKey = (k) => k.split(",").map(Number);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const rand = (n) => Math.floor(Math.random() * n);
const TAU = Math.PI * 2;

function wrapA(a) { a = ((a % TAU) + TAU) % TAU; return a > Math.PI ? a - TAU : a; }
function hexToRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function lerpColor(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------------- board shapes (axial coords) ---------------- */

function hexagonCells(radius) {
  const cells = [];
  for (let q = -radius; q <= radius; q++)
    for (let r = -radius; r <= radius; r++)
      if (Math.abs(q + r) <= radius) cells.push(keyOf(q, r));
  return cells;
}
function triangleCells(n) {
  const cells = [];
  for (let q = 0; q < n; q++)
    for (let r = 0; r < n - q; r++) cells.push(keyOf(q, r));
  return cells;
}
function donutCells(radius) { return hexagonCells(radius).filter((k) => k !== "0,0"); }
function rhombusCells(w, h) {
  const cells = [];
  for (let q = 0; q < w; q++)
    for (let r = 0; r < h; r++) cells.push(keyOf(q, r));
  return cells;
}
function blobCells(n) {
  const cells = new Set(["0,0"]);
  let guard = 0;
  while (cells.size < n && guard++ < 4000) {
    const arr = [...cells];
    const [q, r] = parseKey(arr[rand(arr.length)]);
    const [dq, dr] = DIRS[rand(6)];
    cells.add(keyOf(q + dq, r + dr));
  }
  return [...cells];
}

/* ---------------- difficulty progression ----------------
   Dials, per level: score threshold, palette size, dots needed for a
   full charge (popAt), tile budget for the level, pre-seeded tiles,
   and locked cells. Tune freely.                                 */

function levelConfig(level) {
  const shapes = [
    () => hexagonCells(2),
    () => triangleCells(5),
    () => donutCells(2),
    () => rhombusCells(4, 4),
    () => blobCells(17),
  ];
  const threshold = 100 + 80 * (level - 1);
  const numColors = Math.min(PALETTE.length, level < 2 ? 4 : level < 4 ? 5 : level < 6 ? 6 : 7);
  const popAt = level < 5 ? 6 : level < 9 ? 7 : 8;
  const dotsNeeded = threshold / POINTS_PER_DOT;
  // enough tiles to make it winnable, with a margin that shrinks as levels rise
  const tileBudget = Math.max(10, Math.round(dotsNeeded / 2.4) + 10 - Math.floor(level / 2));
  const seedTiles = 4 + Math.floor((level - 1) / 3);
  const lockCount = level >= 3 ? Math.min(3, 1 + Math.floor((level - 3) / 2)) : 0;
  return {
    cells: shapes[(level - 1) % shapes.length](),
    threshold, numColors, popAt, tileBudget, seedTiles, lockCount,
  };
}

/* ---------------- logical tiles ---------------- */

function genTile(numColors) {
  const weights = [0.30, 0.26, 0.20, 0.14, 0.10].slice(0, Math.min(MAX_RINGS, numColors));
  const wSum = weights.reduce((a, b) => a + b, 0);
  let nRings = 1, roll = Math.random() * wSum, acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll < acc) { nRings = i + 1; break; }
  }
  const colors = [...Array(numColors).keys()];
  for (let i = colors.length - 1; i > 0; i--) {
    const j = rand(i + 1); [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  const lo = Math.max(MIN_TILE_DOTS, nRings);
  const hi = Math.min(MAX_TILE_DOTS, nRings * MAX_RING_DOTS);
  let remaining = lo + rand(hi - lo + 1) - nRings;
  const dots = Array(nRings).fill(1);
  while (remaining-- > 0) {
    const open = dots.reduce((a, d, i) => (d < MAX_RING_DOTS ? (a.push(i), a) : a), []);
    dots[open[rand(open.length)]]++;
  }
  return { rings: dots.map((d, i) => ({ color: colors[i], dots: d })) };
}
const outer = (tile) => tile.rings[tile.rings.length - 1];
const cloneTiles = (tiles) => {
  const out = {};
  for (const k in tiles) out[k] = { rings: tiles[k].rings.map((r) => ({ ...r })) };
  return out;
};
const cloneLocks = (locks) => {
  const out = {};
  for (const k in locks) out[k] = { ...locks[k] };
  return out;
};
const lockBlocks = (lock) => lock && lock.filled < lock.holes;

function seedBoard(cfg) {
  const tiles = {};
  const open = [...cfg.cells];
  for (let i = 0; i < cfg.seedTiles && open.length; i++) {
    const idx = rand(open.length);
    tiles[open[idx]] = genTile(cfg.numColors);
    open.splice(idx, 1);
  }
  let dirty = true, guard = 0;
  while (dirty && guard++ < 200) {   // stabilize: no adjacent matching outers
    dirty = false;
    for (const k in tiles) {
      const [q, r] = parseKey(k);
      for (const [dq, dr] of DIRS) {
        const nk = keyOf(q + dq, r + dr);
        if (tiles[nk] && outer(tiles[nk]).color === outer(tiles[k]).color) {
          outer(tiles[nk]).color = (outer(tiles[nk]).color + 1) % cfg.numColors;
          dirty = true;
        }
      }
    }
  }
  // locks on cells left empty
  const locks = {};
  const free = cfg.cells.filter((k) => !tiles[k]);
  for (let i = 0; i < cfg.lockCount && free.length > 4; i++) {
    const idx = rand(free.length);
    locks[free[idx]] = { color: rand(cfg.numColors), holes: 3 + rand(3), filled: 0 };
    free.splice(idx, 1);
  }
  return { tiles, locks };
}

/* ---------------- cascade resolution (pure logic) ----------------
   Merge direction: the more recently modified tile pulls (the placed
   tile starts most recent, so cascades flow outward from it).
   Pops happen after merges settle; popped dots first fill same-color
   locks (nearest first) and only the remainder scores.            */

function hexCenter(k) {
  const [q, r] = parseKey(k);
  return { x: HEX * Math.sqrt(3) * (q + r / 2), y: HEX * 1.5 * r };
}

function findMerge(tiles, recency) {
  let best = null;
  for (const k in tiles) {
    const [q, r] = parseKey(k);
    const ocK = outer(tiles[k]).color;
    for (const [dq, dr] of DIRS) {
      const nk = keyOf(q + dq, r + dr);
      if (!tiles[nk] || outer(tiles[nk]).color !== ocK) continue;
      const ra = recency[k] || 0, rb = recency[nk] || 0;
      let puller, loser;
      if (ra !== rb) [puller, loser] = ra > rb ? [k, nk] : [nk, k];
      else [puller, loser] =
        outer(tiles[k]).dots >= outer(tiles[nk]).dots ? [k, nk] : [nk, k];
      const prio = Math.max(ra, rb);
      if (!best || prio > best.prio) best = { puller, loser, prio };
    }
  }
  return best;
}

function resolvePlacement(startTiles, placedKey, startLocks, popAt) {
  const tiles = cloneTiles(startTiles);
  const locks = cloneLocks(startLocks);
  const steps = [];
  const recency = { [placedKey]: 1 };
  let counter = 2, gained = 0;
  for (;;) {
    let m;
    while ((m = findMerge(tiles, recency))) {
      const { puller, loser } = m;
      const lost = tiles[loser].rings.pop();
      outer(tiles[puller]).dots += lost.dots;
      recency[loser] = counter++;
      recency[puller] = counter++;
      if (tiles[loser].rings.length === 0) delete tiles[loser];
      steps.push({ event: { type: "merge", from: loser, to: puller } });
    }
    let popped = false;
    for (const k of Object.keys(tiles)) {
      while (tiles[k] && tiles[k].rings.length && outer(tiles[k]).dots >= popAt) {
        const ring = tiles[k].rings.pop();
        recency[k] = counter++;
        if (tiles[k].rings.length === 0) delete tiles[k];
        // same-color locks absorb dots first, nearest lock first
        const c0 = hexCenter(k);
        let remaining = ring.dots;
        const fills = [];
        const cand = Object.keys(locks)
          .filter((lk) => locks[lk].color === ring.color && lockBlocks(locks[lk]))
          .sort((a, b) => {
            const A = hexCenter(a), B = hexCenter(b);
            return ((A.x - c0.x) ** 2 + (A.y - c0.y) ** 2) - ((B.x - c0.x) ** 2 + (B.y - c0.y) ** 2);
          });
        for (const lk of cand) {
          if (!remaining) break;
          const take = Math.min(locks[lk].holes - locks[lk].filled, remaining);
          locks[lk].filled += take;
          remaining -= take;
          fills.push({ key: lk, count: take });
        }
        const points = remaining * POINTS_PER_DOT;
        gained += points;
        steps.push({ event: { type: "pop", at: k, color: ring.color, dots: ring.dots, scored: remaining, points, fills } });
        popped = true;
      }
    }
    if (!popped) break;
  }
  return { final: tiles, finalLocks: locks, steps, gained };
}

/* ---------------- visual model ----------------
   Dots drift with Brownian noise around evenly-spaced anchor slots
   (OU process) while each ring's anchor frame slowly rotates.
   Ring radii lerp toward their slot, so when an outer ring is consumed
   the survivors drift outward into the freed slots.               */

function makeVRing(colorIdx, nDots, radius) {
  const base = Math.random() * TAU;
  return {
    color: colorIdx, base, rad: radius,
    spin: (Math.random() - 0.5) * 0.26,
    flash: 0,
    dots: Array.from({ length: nDots }, (_, i) => ({
      angle: base + (i * TAU) / nDots + (Math.random() - 0.5) * 0.3,
      vel: 0, idx: i,
    })),
  };
}
function makeVTile(tile, now) {
  const n = tile.rings.length;
  return {
    born: now,
    rings: tile.rings.map((r, i) => makeVRing(r.color, r.dots, slotRad(MAX_RINGS - n + i))),
  };
}
function reindexRing(ring) {
  const sorted = [...ring.dots].sort(
    (a, b) => wrapA(a.angle - ring.base) - wrapA(b.angle - ring.base)
  );
  sorted.forEach((d, i) => { d.idx = i; });
}
function updateRing(ring, dt, still, targetRad) {
  ring.rad += (targetRad - ring.rad) * Math.min(1, 9 * dt);
  ring.base += ring.spin * dt;
  ring.flash *= Math.exp(-4 * dt);
  const n = ring.dots.length;
  for (const d of ring.dots) {
    const target = ring.base + (d.idx * TAU) / Math.max(1, n);
    const diff = wrapA(target - d.angle);
    if (still) { d.angle += diff * Math.min(1, 6 * dt); continue; }
    d.vel += (diff * SPRING + (Math.random() * 2 - 1) * BROWNIAN) * dt;
    d.vel *= Math.exp(-DRAG * dt);
    d.angle += d.vel * dt;
  }
}

/* ---------------- geometry & drawing ---------------- */

function pixelToKey(x, y) {
  const qf = ((Math.sqrt(3) / 3) * x - y / 3) / HEX;
  const rf = ((2 / 3) * y) / HEX;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(-qf - rf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - (-qf - rf));
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return keyOf(q, r);
}
function tracePath(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const px = cx + size * Math.cos(a), py = cy + size * Math.sin(a);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function drawPole(ctx, cx, cy, scale, lit) {
  ctx.beginPath(); ctx.arc(cx, cy, 3.2 * scale, 0, TAU);
  ctx.fillStyle = lit ? "#94a3b8" : "#3d495e"; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 1.4 * scale, 0, TAU);
  ctx.fillStyle = "#0b0f17"; ctx.fill();
}

function drawVTile(ctx, cx, cy, vt, scale, now, popAt) {
  const grow = Math.min(1, (now - vt.born) / 200);
  const s = scale * (0.55 + 0.45 * (1 - (1 - grow) * (1 - grow)));
  drawPole(ctx, cx, cy, scale, true);
  vt.rings.forEach((ring, i) => {
    const rad = ring.rad * s;
    const col = PALETTE[ring.color];
    const n = ring.dots.length;
    const isOuter = i === vt.rings.length - 1;
    const charge = Math.min(1, Math.max(0, (n - 1) / (popAt - 1)));
    const pulse = n === popAt - 1 ? 0.5 + 0.5 * Math.sin(now / 160) : 0;
    const glowAmt = charge * charge * 15 + pulse * 8 + ring.flash * 16;

    ctx.save();
    ctx.globalAlpha = isOuter ? 1 : 0.78;
    if (glowAmt > 0.5) { ctx.shadowColor = col.glow; ctx.shadowBlur = glowAmt * s; }
    ctx.strokeStyle = lerpColor(col.ring, col.glow, charge * 0.45 + pulse * 0.2);
    ctx.lineWidth = (isOuter ? RING_W_OUT : RING_W_IN) * s;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.stroke();
    ctx.restore();

    const dr = (isOuter ? DOT_R_OUT : DOT_R_IN) * s;
    for (const d of ring.dots) {
      const dx = cx + rad * Math.cos(d.angle), dy = cy + rad * Math.sin(d.angle);
      ctx.beginPath(); ctx.arc(dx, dy, dr, 0, TAU);
      ctx.fillStyle = "#0b0f17"; ctx.fill();
      ctx.lineWidth = (isOuter ? 1.3 : 1.0) * s;
      ctx.strokeStyle = col.glow;
      ctx.stroke();
    }
  });
}

const lockHoleX = (cx, i, n) => cx - ((n - 1) * 8) / 2 + i * 8;
const LOCK_HOLE_Y = 15;

function drawLock(ctx, cx, cy, lock, dt) {
  lock.flash = (lock.flash || 0) * Math.exp(-4 * dt);
  const col = PALETTE[lock.color];
  ctx.save();
  if (lock.flash > 0.05) { ctx.shadowColor = col.glow; ctx.shadowBlur = lock.flash * 18; }
  // shackle
  ctx.strokeStyle = col.ring;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy - 9, 6, Math.PI, 0);
  ctx.moveTo(cx - 6, cy - 9); ctx.lineTo(cx - 6, cy - 5);
  ctx.moveTo(cx + 6, cy - 9); ctx.lineTo(cx + 6, cy - 5);
  ctx.stroke();
  // body
  rrect(ctx, cx - 9.5, cy - 5, 19, 14, 3);
  ctx.fillStyle = col.ring; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy + 1.2, 2.1, 0, TAU);
  ctx.fillStyle = "#0b0f17"; ctx.fill();
  ctx.fillRect(cx - 0.9, cy + 1.2, 1.8, 3.6);
  ctx.restore();
  // holes: open dots that fill as matching dots are collected
  for (let i = 0; i < lock.holes; i++) {
    const hx = lockHoleX(cx, i, lock.holes), hy = cy + LOCK_HOLE_Y;
    ctx.beginPath(); ctx.arc(hx, hy, 2.7, 0, TAU);
    if (i < lock.filled) {
      ctx.fillStyle = col.ring; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = col.glow; ctx.stroke();
    } else {
      ctx.fillStyle = "#0b0f17"; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = col.ring; ctx.stroke();
    }
  }
}

/* ============================================================ */

export default function RingCharge() {
  const [level, setLevel] = useState(1);
  const [cfg, setCfg] = useState(() => levelConfig(1));
  const [hand, setHand] = useState([null, null, null]);
  const [deck, setDeck] = useState(0);            // tiles left beyond the hand
  const [selected, setSelected] = useState(null);
  const [levelScore, setLevelScore] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [levelStartTotal, setLevelStartTotal] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [levelDone, setLevelDone] = useState(false);
  const [gameOver, setGameOver] = useState(null); // null | "board" | "tiles"

  const canvasRef = useRef(null);
  const logicTiles = useRef({});
  const logicLocks = useRef({});
  const vRef = useRef({ tiles: {}, locks: {}, flights: [], sparks: [], floats: [], segments: [], hover: null });
  const stateRef = useRef({});
  const reducedRef = useRef(false);

  /* geometry: score bar strip + board + hand row, all on one canvas */
  const geom = useMemo(() => {
    const centers = {};
    cfg.cells.forEach((k) => { centers[k] = hexCenter(k); });
    const xs = Object.values(centers).map((c) => c.x);
    const ys = Object.values(centers).map((c) => c.y);
    const pad = HEX + 14;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const top = minY - 46;
    const midX = (minX + maxX) / 2;
    const handY = maxY + HAND_SIZE + 26;
    return {
      centers, minX, top,
      W: maxX - minX,
      H: handY + HAND_SIZE * 1.25 + 10 - top,
      handCenters: [-1, 0, 1].map((o) => ({ x: midX + o * (HAND_SIZE * 3), y: handY })),
      barX: minX + 8, barW: maxX - minX - 16, barY: minY - 34,
    };
  }, [cfg]);

  stateRef.current = { cfg, hand, deck, selected, animating, levelDone, gameOver, geom, levelScore };

  const startLevel = useCallback((lv) => {
    const c = levelConfig(lv);
    const { tiles, locks } = seedBoard(c);
    logicTiles.current = tiles;
    logicLocks.current = locks;
    const now = performance.now();
    const vt = {};
    for (const k in tiles) vt[k] = makeVTile(tiles[k], now - 500);
    const vl = {};
    for (const k in locks) vl[k] = { ...locks[k], flash: 0 };
    vRef.current = { tiles: vt, locks: vl, flights: [], sparks: [], floats: [], segments: [], hover: null };
    setCfg(c);
    setHand([genTile(c.numColors), genTile(c.numColors), genTile(c.numColors)]);
    setDeck(c.tileBudget - 3);
    setSelected(null);
    setLevelScore(0);
    setLevelDone(false);
    setGameOver(null);
  }, []);

  useEffect(() => {
    reducedRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    startLevel(1);
  }, [startLevel]);

  const vHandRef = useRef([null, null, null]);
  useEffect(() => {
    const now = performance.now();
    vHandRef.current = hand.map((t) => (t ? makeVTile(t, now) : null));
  }, [hand]);

  /* ---------------- render loop ---------------- */
  useEffect(() => {
    let raf, last = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const S = stateRef.current, V = vRef.current, G = S.geom;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(G.W * dpr) || canvas.height !== Math.round(G.H * dpr)) {
        canvas.width = Math.round(G.W * dpr);
        canvas.height = Math.round(G.H * dpr);
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, G.W, G.H);
      ctx.translate(-G.minX, -G.top);
      const still = reducedRef.current;
      const popAt = S.cfg.popAt;

      const canPlace = S.selected !== null && S.hand[S.selected] &&
                       !S.animating && !S.levelDone && !S.gameOver;

      /* board hexes + locks */
      for (const k of S.cfg.cells) {
        const { x, y } = G.centers[k];
        const occupied = !!V.tiles[k];
        const locked = !!V.locks[k];
        const open = !occupied && !locked;
        const hovered = canPlace && open && V.hover === k;
        tracePath(ctx, x, y, HEX - 2);
        ctx.fillStyle = hovered ? "#233047" : occupied ? "#161d2b" : locked ? "#10141f" : "#121826";
        ctx.fill();
        ctx.lineWidth = hovered ? 2.4 : canPlace && open ? 1.8 : 1.2;
        ctx.strokeStyle = hovered ? "#7dd3fc" : canPlace && open ? "#3b82f6" : "#2a3448";
        ctx.stroke();
        if (locked) drawLock(ctx, x, y, V.locks[k], dt);
        else if (!occupied) drawPole(ctx, x, y, 1, false);
      }

      /* tiles: rings lerp outward into freed slots, dots drift */
      for (const k in V.tiles) {
        const vt = V.tiles[k];
        const n = vt.rings.length;
        vt.rings.forEach((ring, i) => updateRing(ring, dt, still, slotRad(MAX_RINGS - n + i)));
        const { x, y } = G.centers[k];
        drawVTile(ctx, x, y, vt, 1, now, popAt);
      }

      /* score bar */
      {
        const { barX, barW, barY } = G;
        ctx.font = "600 11px 'Avenir Next','Segoe UI',system-ui,sans-serif";
        ctx.fillStyle = "#8fa0b8";
        ctx.textAlign = "left";
        ctx.fillText(`${S.levelScore} pts`, barX, barY - 5);
        ctx.textAlign = "right";
        ctx.fillText(`goal ${S.cfg.threshold}`, barX + barW, barY - 5);
        rrect(ctx, barX, barY, barW, BAR_H, BAR_H / 2);
        ctx.fillStyle = "#1c2434"; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = "#2a3448"; ctx.stroke();
        ctx.save();
        rrect(ctx, barX, barY, barW, BAR_H, BAR_H / 2);
        ctx.clip();
        let x = barX;
        for (const seg of V.segments) {
          const w = (seg.pts / S.cfg.threshold) * barW;
          const hot = Math.exp(-(now - seg.born) / 300);
          const col = PALETTE[seg.color];
          ctx.fillStyle = lerpColor(col.ring, col.glow, hot * 0.8);
          ctx.fillRect(x - 0.5, barY, w + 1, BAR_H);
          x += w;
          if (x > barX + barW) break;
        }
        ctx.restore();
      }

      /* flights: glowing dots traveling to rings, locks, or the bar */
      V.flights = V.flights.filter((f) => {
        const t = (now - f.t0) / f.dur;
        if (t >= 1) {
          if (f.land === "ring") {
            const ang = Math.atan2(f.y1 - f.tcy, f.x1 - f.tcx);
            f.ring.dots.push({ angle: ang, vel: f.spinKick, idx: 0 });
            reindexRing(f.ring);
            f.ring.flash = 1;
          } else if (f.land === "bar") {
            V.segments.push({ color: f.color, pts: POINTS_PER_DOT, born: now });
          } else if (f.land === "lock") {
            const L = V.locks[f.lockKey];
            if (L) {
              L.filled++; L.flash = 1;
              if (L.filled >= L.holes) {
                const c = G.centers[f.lockKey];
                V.sparks.push({ kind: "ring", x: c.x, y: c.y, r0: 12, color: L.color, t0: now, dur: 550 });
                for (let i = 0; i < 8; i++) {
                  const a = (i / 8) * TAU;
                  V.sparks.push({
                    kind: "dot", color: L.color, x: c.x, y: c.y,
                    vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, t0: now, dur: 550,
                  });
                }
                delete V.locks[f.lockKey];
              }
            }
          }
          return false;
        }
        const col = PALETTE[f.color];
        let px, py;
        if (t <= 0) { px = f.x0; py = f.y0; }
        else {
          const e = t * t * (3 - 2 * t);
          const u = 1 - e;
          px = u * u * f.x0 + 2 * u * e * f.cx + e * e * f.x1;
          py = u * u * f.y0 + 2 * u * e * f.cy + e * e * f.y1;
        }
        ctx.save();
        ctx.shadowColor = col.glow;
        ctx.shadowBlur = 13;
        ctx.beginPath(); ctx.arc(px, py, 3.1, 0, TAU);
        ctx.fillStyle = col.ring; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, 1.4, 0, TAU);
        ctx.fillStyle = col.glow; ctx.fill();
        ctx.restore();
        return true;
      });

      /* sparks */
      V.sparks = V.sparks.filter((p) => {
        const t = (now - p.t0) / p.dur;
        if (t >= 1) return false;
        const col = PALETTE[p.color];
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.shadowColor = col.glow;
        ctx.shadowBlur = 10;
        if (p.kind === "ring") {
          ctx.strokeStyle = col.glow;
          ctx.lineWidth = 3.5 * (1 - t) + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r0 + 26 * t, 0, TAU); ctx.stroke();
        } else {
          ctx.fillStyle = col.ring;
          ctx.beginPath();
          ctx.arc(p.x + p.vx * t * p.dur / 1000, p.y + p.vy * t * p.dur / 1000, 2.6, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
        return true;
      });

      /* floating score text */
      V.floats = V.floats.filter((f) => {
        const t = (now - f.t0) / 1100;
        if (t >= 1) return false;
        ctx.save();
        ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
        ctx.fillStyle = PALETTE[f.color].glow;
        ctx.font = "700 17px 'Avenir Next','Segoe UI',system-ui,sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`+${f.points}`, f.x, f.y - HEX * 0.5 - 30 * t);
        ctx.restore();
        return true;
      });

      /* hand row */
      const vh = vHandRef.current;
      G.handCenters.forEach(({ x, y }, i) => {
        const tile = vh[i];
        const isSel = S.selected === i;
        ctx.save();
        if (isSel) { ctx.shadowColor = "#7dd3fc"; ctx.shadowBlur = 12; }
        tracePath(ctx, x, y, HAND_SIZE);
        ctx.fillStyle = tile ? (isSel ? "#22304a" : "#161d2b") : "#0e1420";
        ctx.fill();
        ctx.lineWidth = isSel ? 3 : 1.4;
        ctx.strokeStyle = isSel ? "#7dd3fc" : tile ? "#3a4761" : "#1c2434";
        ctx.stroke();
        ctx.restore();
        if (tile) {
          const n = tile.rings.length;
          tile.rings.forEach((ring, ri) => updateRing(ring, dt, still, slotRad(MAX_RINGS - n + ri)));
          drawVTile(ctx, x, y, tile, HAND_SIZE / HEX, now, popAt);
        } else {
          drawPole(ctx, x, y, HAND_SIZE / HEX, false);
        }
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------------- input ---------------- */

  const toBoard = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const G = stateRef.current.geom;
    return {
      x: ((e.clientX - rect.left) / rect.width) * G.W + G.minX,
      y: ((e.clientY - rect.top) / rect.height) * G.H + G.top,
    };
  };

  const onMove = (e) => {
    const S = stateRef.current, V = vRef.current;
    const { x, y } = toBoard(e);
    let cursor = "default";
    const overHand = S.geom.handCenters.findIndex(
      (c) => (x - c.x) ** 2 + (y - c.y) ** 2 < (HAND_SIZE + 4) ** 2
    );
    if (overHand >= 0 && S.hand[overHand] && !S.animating) cursor = "pointer";
    const k = pixelToKey(x, y);
    V.hover = S.cfg.cells.includes(k) ? k : null;
    if (V.hover && !V.tiles[V.hover] && !V.locks[V.hover] && S.selected !== null &&
        S.hand[S.selected] && !S.animating && !S.levelDone && !S.gameOver)
      cursor = "pointer";
    canvasRef.current.style.cursor = cursor;
  };

  const onClick = (e) => {
    const S = stateRef.current;
    const { x, y } = toBoard(e);
    const hi = S.geom.handCenters.findIndex(
      (c) => (x - c.x) ** 2 + (y - c.y) ** 2 < (HAND_SIZE + 4) ** 2
    );
    if (hi >= 0) {
      if (S.hand[hi] && !S.animating) setSelected((s) => (s === hi ? null : hi));
      return;
    }
    const k = pixelToKey(x, y);
    if (S.cfg.cells.includes(k)) place(k);
  };

  /* ---------------- placement & cascade animation ---------------- */

  async function place(cellKey) {
    const S = stateRef.current, V = vRef.current, G = S.geom;
    if (S.animating || S.gameOver || S.levelDone) return;
    if (S.selected === null || !S.hand[S.selected]) return;
    if (logicTiles.current[cellKey] || lockBlocks(logicLocks.current[cellKey])) return;

    const now0 = performance.now();
    const placedTile = S.hand[S.selected];
    const withPlaced = cloneTiles(logicTiles.current);
    withPlaced[cellKey] = { rings: placedTile.rings.map((r) => ({ ...r })) };
    V.tiles[cellKey] = makeVTile(placedTile, now0);

    const newHand = [...S.hand];
    newHand[S.selected] = null;
    const needRefill = newHand.every((t) => !t);
    setHand(newHand);
    setSelected(null);
    setAnimating(true);

    const { final, finalLocks, steps } =
      resolvePlacement(withPlaced, cellKey, logicLocks.current, S.cfg.popAt);
    logicTiles.current = final;
    logicLocks.current = finalLocks;
    const quick = reducedRef.current;
    await sleep(quick ? 120 : 280);

    let sc = S.levelScore;
    for (const st of steps) {
      const ev = st.event;
      if (ev.type === "merge") {
        const from = G.centers[ev.from], to = G.centers[ev.to];
        const loser = V.tiles[ev.from];
        const ring = loser.rings.pop();
        if (!loser.rings.length) delete V.tiles[ev.from];
        const target = V.tiles[ev.to];
        const tring = target.rings[target.rings.length - 1];
        const approach = Math.atan2(from.y - to.y, from.x - to.x);
        const n = ring.dots.length;
        const t0 = performance.now();
        const dur = quick ? 180 : FLIGHT_MS;
        const stag = quick ? 20 : FLIGHT_STAGGER;
        ring.dots.forEach((d, i) => {
          const x0 = from.x + ring.rad * Math.cos(d.angle);
          const y0 = from.y + ring.rad * Math.sin(d.angle);
          const tAng = approach + (i - (n - 1) / 2) * 0.45;
          const x1 = to.x + tring.rad * Math.cos(tAng);
          const y1 = to.y + tring.rad * Math.sin(tAng);
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          const len = Math.hypot(x1 - x0, y1 - y0) || 1;
          const bow = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 18);
          V.flights.push({
            land: "ring", color: ring.color,
            x0, y0, x1, y1,
            cx: mx + (-(y1 - y0) / len) * bow,
            cy: my + ((x1 - x0) / len) * bow,
            tcx: to.x, tcy: to.y,
            t0: t0 + i * stag, dur,
            ring: tring,
            spinKick: (Math.random() - 0.5) * 2,
          });
        });
        await sleep(dur + n * stag + (quick ? 60 : 170));
      } else {
        /* pop: ring flash at the cell, dots fly to locks / the score bar */
        const at = G.centers[ev.at];
        const vt = V.tiles[ev.at];
        const ring = vt.rings[vt.rings.length - 1];
        const t0 = performance.now();
        const dur = quick ? 220 : BAR_FLIGHT_MS;
        const stag = quick ? 25 : BAR_STAGGER;
        V.sparks.push({ kind: "ring", x: at.x, y: at.y, r0: ring.rad, color: ring.color, t0, dur: 550 });

        let di = 0, launched = 0;
        const launch = (x1, y1, land, extra) => {
          const d = ring.dots[di++];
          const x0 = at.x + ring.rad * Math.cos(d.angle);
          const y0 = at.y + ring.rad * Math.sin(d.angle);
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          const len = Math.hypot(x1 - x0, y1 - y0) || 1;
          const bow = (Math.random() < 0.5 ? -1 : 1) * (16 + Math.random() * 22);
          V.flights.push({
            land, color: ring.color,
            x0, y0, x1, y1,
            cx: mx + (-(y1 - y0) / len) * bow,
            cy: my + ((x1 - x0) / len) * bow,
            t0: t0 + launched++ * stag, dur,
            ...extra,
          });
        };
        for (const f of ev.fills) {
          const lc = G.centers[f.key];
          const L = V.locks[f.key];
          for (let j = 0; j < f.count; j++) {
            const holeIdx = L ? Math.min(L.holes - 1, L.filled + j) : 0;
            launch(
              lockHoleX(lc.x, holeIdx, L ? L.holes : 1),
              lc.y + LOCK_HOLE_Y,
              "lock", { lockKey: f.key }
            );
          }
        }
        for (let j = 0; j < ev.scored; j++) {
          const fillX = G.barX + Math.min(1, (sc + j * POINTS_PER_DOT) / S.cfg.threshold) * G.barW;
          launch(fillX, G.barY + BAR_H / 2, "bar", {});
        }

        vt.rings.pop();
        if (!vt.rings.length) delete V.tiles[ev.at];
        if (ev.points > 0) V.floats.push({ x: at.x, y: at.y, points: ev.points, color: ev.color, t0 });
        await sleep(dur + ev.dots * stag + (quick ? 60 : 140));
        sc += ev.points;
        setLevelScore(sc);
        setTotalScore((t) => t + ev.points);
      }
    }

    /* refill from the level's tile budget */
    let handAfter = newHand;
    if (needRefill) {
      const draw = Math.min(3, S.deck);
      handAfter = Array.from({ length: 3 }, (_, i) => (i < draw ? genTile(S.cfg.numColors) : null));
      setHand(handAfter);
      setDeck(S.deck - draw);
    }

    if (sc >= S.cfg.threshold) {
      setLevelDone(true);
    } else {
      const boardFull = S.cfg.cells.every((c) => final[c] || lockBlocks(finalLocks[c]));
      const outOfTiles = handAfter.every((t) => !t);
      if (boardFull) setGameOver("board");
      else if (outOfTiles) setGameOver("tiles");
    }
    setAnimating(false);
  }

  /* ---------------- HTML shell ---------------- */

  const tilesLeft = deck + hand.filter(Boolean).length;
  const canPlaceNow = selected !== null && hand[selected] && !animating && !levelDone && !gameOver;

  return (
    <div style={{
      minHeight: "100vh", background: "#0b0f17", color: "#dbe3f0",
      fontFamily: "'Avenir Next','Segoe UI',system-ui,sans-serif",
      display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 12px",
    }}>
      <div style={{ width: "100%", maxWidth: geom.W, display: "flex", alignItems: "baseline",
                    justifyContent: "space-between", marginBottom: 2 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: ".08em" }}>
          RING<span style={{ color: "#38bdf8" }}>CHARGE</span>
        </div>
        <div style={{ fontSize: 13, color: "#8fa0b8" }}>
          Level {level} &nbsp;·&nbsp; Tiles {tilesLeft} &nbsp;·&nbsp; Total {totalScore}
        </div>
      </div>

      <div style={{ position: "relative", width: "100%", maxWidth: geom.W }}>
        <canvas
          ref={canvasRef}
          onMouseMove={onMove}
          onClick={onClick}
          style={{ width: "100%", display: "block" }}
        />
        {(levelDone || gameOver) && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "rgba(11,15,23,.82)", borderRadius: 12, gap: 12,
          }}>
            <div style={{ fontSize: 26, fontWeight: 700 }}>
              {levelDone ? `Level ${level} charged!`
                : gameOver === "tiles" ? "Out of tiles" : "Board full"}
            </div>
            <div style={{ color: "#8fa0b8", fontSize: 14 }}>
              {levelDone
                ? `${levelScore} points — goal was ${cfg.threshold}`
                : gameOver === "tiles"
                  ? `${levelScore} of ${cfg.threshold} points — the tile supply ran dry.`
                  : "No empty poles left to place a tile."}
            </div>
            <button
              onClick={() => {
                if (levelDone) {
                  const nl = level + 1;
                  setLevel(nl);
                  setLevelStartTotal(totalScore);
                  startLevel(nl);
                } else {
                  setTotalScore(levelStartTotal);
                  startLevel(level);
                }
              }}
              style={{
                padding: "10px 26px", fontSize: 15, fontWeight: 600, borderRadius: 8,
                border: "none", cursor: "pointer", color: "#0b0f17",
                background: levelDone
                  ? "linear-gradient(90deg,#38bdf8,#a78bfa)"
                  : "#e2e8f0",
              }}>
              {levelDone ? `Start level ${level + 1}` : `Retry level ${level}`}
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 12.5, color: "#657894", textAlign: "center", maxWidth: 500 }}>
        {canPlaceNow
          ? "Click an empty hex to place the tile."
          : `Match outer rings to pull dots; ${cfg.popAt} dots fully charges a ring. Locks eat matching dots before they score.`}
      </div>
    </div>
  );
}
