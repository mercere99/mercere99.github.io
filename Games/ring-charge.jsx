import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

/* ============================================================
   RING CHARGE — hex-map ring-merging puzzle (canvas edition)
   ------------------------------------------------------------
   Gameplay knobs
   ============================================================ */
const HEX = 46;                 // hex circumradius (board units)
const POINTS_PER_DOT = 5;
const POP_AT = 6;               // dots for a full charge
const BASE_THRESHOLD = 100;
const THRESHOLD_STEP = 100;
const MAX_RINGS = 5;            // rings per tile (also capped by palette size)
const MIN_TILE_DOTS = 2, MAX_TILE_DOTS = 7, MAX_RING_DOTS = 5;
const SEED_TILES = 4;

/* Visual knobs — 5 rings must fit inside the hex inradius (HEX*√3/2 ≈ 39.8):
   innermost hugs the pole, outermost edge = RING_BASE + 4*RING_STEP + RING_W/2 ≈ 37.6 */
const RING_BASE = 8.5, RING_STEP = 6.6, RING_W = 5.4, DOT_R = 2.3;
const FLIGHT_MS = 540;          // merge flight duration per dot
const FLIGHT_STAGGER = 55;      // ms between successive dot launches
const BROWNIAN = 1.9;           // noise strength on dot angular velocity
const SPRING = 2.2;             // pull toward evenly-spaced anchor slots
const DRAG = 1.7;               // velocity damping
const HAND_SIZE = 34;

const PALETTE = [
  { name: "crimson", ring: "#f43f5e", glow: "#ffb3c0" },
  { name: "amber",   ring: "#f59e0b", glow: "#ffe08a" },
  { name: "emerald", ring: "#10b981", glow: "#9df5cf" },
  { name: "azure",   ring: "#38bdf8", glow: "#cbeeff" },
  { name: "violet",  ring: "#a78bfa", glow: "#e6ddff" },
];

const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const keyOf = (q, r) => `${q},${r}`;
const parseKey = (k) => k.split(",").map(Number);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const rand = (n) => Math.floor(Math.random() * n);
const TAU = Math.PI * 2;
const ringRad = (i) => RING_BASE + i * RING_STEP;

function wrapA(a) { a = ((a % TAU) + TAU) % TAU; return a > Math.PI ? a - TAU : a; }
function hexToRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function lerpColor(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
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

function levelConfig(level) {
  const shapes = [
    () => hexagonCells(2),
    () => triangleCells(5),
    () => donutCells(2),
    () => rhombusCells(4, 4),
    () => blobCells(17),
  ];
  return {
    cells: shapes[(level - 1) % shapes.length](),
    threshold: BASE_THRESHOLD + (level - 1) * THRESHOLD_STEP,
    numColors: level === 1 ? 4 : 5,
  };
}

/* ---------------- logical tiles ---------------- */

function genTile(numColors) {
  // 1..5 rings (can't exceed palette size since colors are distinct per tile)
  const weights = [0.30, 0.26, 0.20, 0.14, 0.10].slice(0, Math.min(MAX_RINGS, numColors));
  const wSum = weights.reduce((a, b) => a + b, 0);
  let nRings = 1, roll = Math.random() * wSum, acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll < acc) { nRings = i + 1; break; }
  }
  // distinct colors, random order
  const colors = [...Array(numColors).keys()];
  for (let i = colors.length - 1; i > 0; i--) {
    const j = rand(i + 1); [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  // total dots in [max(MIN_TILE_DOTS, nRings) .. min(MAX_TILE_DOTS, nRings*MAX_RING_DOTS)],
  // each ring gets at least 1 and at most MAX_RING_DOTS
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

function seedBoard(cfg) {
  const tiles = {};
  const open = [...cfg.cells];
  for (let i = 0; i < SEED_TILES && open.length; i++) {
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
  return tiles;
}

/* ---------------- cascade resolution (pure logic) ---------------- */

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

function resolvePlacement(startTiles, placedKey) {
  const tiles = cloneTiles(startTiles);
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
      steps.push({ event: { type: "merge", from: loser, to: puller, dots: lost.dots } });
    }
    let popped = false;
    for (const k of Object.keys(tiles)) {
      while (tiles[k] && tiles[k].rings.length && outer(tiles[k]).dots >= POP_AT) {
        const ring = tiles[k].rings.pop();
        gained += ring.dots * POINTS_PER_DOT;
        recency[k] = counter++;
        if (tiles[k].rings.length === 0) delete tiles[k];
        steps.push({ event: { type: "pop", at: k, points: ring.dots * POINTS_PER_DOT, color: ring.color } });
        popped = true;
      }
    }
    if (!popped) break;
  }
  return { final: tiles, steps, gained };
}

/* ---------------- visual model ----------------
   Dots are particles: each drifts with Brownian noise around an
   evenly-spaced anchor slot (Ornstein–Uhlenbeck around the anchor),
   while the whole ring of anchors slowly rotates. */

function makeVRing(colorIdx, nDots) {
  const base = Math.random() * TAU;
  return {
    color: colorIdx,
    base,
    spin: (Math.random() - 0.5) * 0.26,
    flash: 0,
    dots: Array.from({ length: nDots }, (_, i) => ({
      angle: base + (i * TAU) / nDots + (Math.random() - 0.5) * 0.3,
      vel: 0,
      idx: i,
    })),
  };
}
function makeVTile(tile, now) {
  return { born: now, rings: tile.rings.map((r) => makeVRing(r.color, r.dots)) };
}
function reindexRing(ring) {
  const sorted = [...ring.dots].sort(
    (a, b) => wrapA(a.angle - ring.base) - wrapA(b.angle - ring.base)
  );
  sorted.forEach((d, i) => { d.idx = i; });
}
function updateRing(ring, dt, still) {
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

/* ---------------- geometry ---------------- */

function hexCenter(k) {
  const [q, r] = parseKey(k);
  return { x: HEX * Math.sqrt(3) * (q + r / 2), y: HEX * 1.5 * r };
}
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

/* ---------------- drawing ---------------- */

function drawPole(ctx, cx, cy, scale, lit) {
  ctx.beginPath(); ctx.arc(cx, cy, 3.2 * scale, 0, TAU);
  ctx.fillStyle = lit ? "#94a3b8" : "#3d495e"; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 1.4 * scale, 0, TAU);
  ctx.fillStyle = "#0b0f17"; ctx.fill();
}

function drawVTile(ctx, cx, cy, vt, scale, now) {
  const grow = Math.min(1, (now - vt.born) / 200);
  const s = scale * (0.55 + 0.45 * (1 - (1 - grow) * (1 - grow)));
  drawPole(ctx, cx, cy, scale, true);
  vt.rings.forEach((ring, i) => {
    const rad = ringRad(i) * s;
    const col = PALETTE[ring.color];
    const n = ring.dots.length;
    const charge = Math.min(1, Math.max(0, (n - 1) / (POP_AT - 1)));
    const isOuter = i === vt.rings.length - 1;
    // pulse when one dot away from a full charge
    const pulse = n === POP_AT - 1 ? 0.5 + 0.5 * Math.sin(now / 160) : 0;
    const glowAmt = charge * charge * 15 + pulse * 8 + ring.flash * 16;

    ctx.save();
    ctx.globalAlpha = isOuter ? 1 : 0.8;
    if (glowAmt > 0.5) { ctx.shadowColor = col.glow; ctx.shadowBlur = glowAmt * s; }
    ctx.strokeStyle = lerpColor(col.ring, col.glow, charge * 0.45 + pulse * 0.2);
    ctx.lineWidth = RING_W * s;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.stroke();
    ctx.restore();

    for (const d of ring.dots) {
      const dx = cx + rad * Math.cos(d.angle), dy = cy + rad * Math.sin(d.angle);
      ctx.beginPath(); ctx.arc(dx, dy, DOT_R * s, 0, TAU);
      ctx.fillStyle = "#0b0f17"; ctx.fill();
      ctx.lineWidth = 1.1 * s;
      ctx.strokeStyle = col.glow;
      ctx.stroke();
    }
  });
}

/* ============================================================ */

export default function RingCharge() {
  const [level, setLevel] = useState(1);
  const [cfg, setCfg] = useState(() => levelConfig(1));
  const [hand, setHand] = useState([null, null, null]);
  const [selected, setSelected] = useState(null);
  const [levelScore, setLevelScore] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [levelDone, setLevelDone] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const canvasRef = useRef(null);
  const logicRef = useRef({});      // logical tiles (source of truth for rules)
  const vRef = useRef({ tiles: {}, flights: [], sparks: [], floats: [], hover: null });
  const stateRef = useRef({});      // mirror of React state for the draw loop
  const reducedRef = useRef(false);

  /* geometry for the current board (board area + hand row on one canvas) */
  const geom = useMemo(() => {
    const centers = {};
    cfg.cells.forEach((k) => { centers[k] = hexCenter(k); });
    const xs = Object.values(centers).map((c) => c.x);
    const ys = Object.values(centers).map((c) => c.y);
    const pad = HEX + 14;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const midX = (minX + maxX) / 2;
    const handY = maxY + HAND_SIZE + 26;
    const handCenters = [-1, 0, 1].map((o) => ({ x: midX + o * (HAND_SIZE * 3), y: handY }));
    return {
      centers, minX, minY,
      W: maxX - minX,
      H: handY + HAND_SIZE * 1.25 + 10 - minY,
      handCenters,
    };
  }, [cfg]);

  stateRef.current = { cfg, hand, selected, animating, levelDone, gameOver, geom };

  const startLevel = useCallback((lv) => {
    const c = levelConfig(lv);
    const seeded = seedBoard(c);
    logicRef.current = seeded;
    const now = performance.now();
    const vt = {};
    for (const k in seeded) vt[k] = makeVTile(seeded[k], now - 500);
    vRef.current = { tiles: vt, flights: [], sparks: [], floats: [], hover: null };
    setCfg(c);
    setHand([genTile(c.numColors), genTile(c.numColors), genTile(c.numColors)]);
    setSelected(null);
    setLevelScore(0);
    setLevelDone(false);
    setGameOver(false);
  }, []);

  useEffect(() => {
    reducedRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    startLevel(1);
  }, [startLevel]);

  /* visual hand tiles (rebuilt whenever the hand changes) */
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
      ctx.translate(-G.minX, -G.minY);
      const still = reducedRef.current;

      const canPlace = S.selected !== null && S.hand[S.selected] &&
                       !S.animating && !S.levelDone && !S.gameOver;

      /* board hexes */
      for (const k of S.cfg.cells) {
        const { x, y } = G.centers[k];
        const occupied = !!V.tiles[k];
        const hovered = canPlace && !occupied && V.hover === k;
        tracePath(ctx, x, y, HEX - 2);
        ctx.fillStyle = hovered ? "#233047" : occupied ? "#161d2b" : "#121826";
        ctx.fill();
        ctx.lineWidth = hovered ? 2.4 : canPlace && !occupied ? 1.8 : 1.2;
        ctx.strokeStyle = hovered ? "#7dd3fc" : canPlace && !occupied ? "#3b82f6" : "#2a3448";
        ctx.stroke();
        if (!occupied) drawPole(ctx, x, y, 1, false);
      }

      /* tiles: update particle motion, then draw */
      for (const k in V.tiles) {
        const vt = V.tiles[k];
        for (const ring of vt.rings) updateRing(ring, dt, still);
        const { x, y } = G.centers[k];
        drawVTile(ctx, x, y, vt, 1, now);
      }

      /* flights: glowing dots traveling between rings */
      V.flights = V.flights.filter((f) => {
        const t = (now - f.t0) / f.dur;
        if (t >= 1) {
          const ang = Math.atan2(f.y1 - f.tcy, f.x1 - f.tcx);
          f.ring.dots.push({ angle: ang, vel: f.spinKick, idx: 0 });
          reindexRing(f.ring);
          f.ring.flash = 1;
          return false;
        }
        const col = PALETTE[f.color];
        let px, py;
        if (t <= 0) { px = f.x0; py = f.y0; }
        else {
          const e = t * t * (3 - 2 * t); // smoothstep
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

      /* sparks: pop debris + expanding ring flash */
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
        ctx.fillText(`+${f.points}`, f.x, f.y - HEX * 0.55 - 30 * t);
        ctx.restore();
        return true;
      });

      /* hand row */
      const vh = vHandRef.current;
      G.handCenters.forEach(({ x, y }, i) => {
        const tile = vh[i];
        const isSel = S.selected === i;
        ctx.save();
        if (isSel) { ctx.shadowColor = "#38bdf8"; ctx.shadowBlur = 12; }
        tracePath(ctx, x, y, HAND_SIZE);
        ctx.fillStyle = tile ? (isSel ? "#22304a" : "#161d2b") : "#0e1420";
        ctx.fill();
        ctx.lineWidth = isSel ? 3 : 1.4;
        ctx.strokeStyle = isSel ? "#38bdf8" : tile ? "#3a4761" : "#1c2434";
        ctx.stroke();
        ctx.restore();
        if (tile) {
          for (const ring of tile.rings) updateRing(ring, dt, still);
          drawVTile(ctx, x, y, tile, HAND_SIZE / HEX, now);
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
      y: ((e.clientY - rect.top) / rect.height) * G.H + G.minY,
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
    if (V.hover && !V.tiles[V.hover] && S.selected !== null &&
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
    if (logicRef.current[cellKey]) return;

    const now0 = performance.now();
    const placedTile = S.hand[S.selected];
    const withPlaced = cloneTiles(logicRef.current);
    withPlaced[cellKey] = { rings: placedTile.rings.map((r) => ({ ...r })) };
    V.tiles[cellKey] = makeVTile(placedTile, now0);

    const newHand = [...S.hand];
    newHand[S.selected] = null;
    const needRefill = newHand.every((t) => !t);
    setHand(newHand);
    setSelected(null);
    setAnimating(true);

    const { final, steps } = resolvePlacement(withPlaced, cellKey);
    logicRef.current = final;
    const quick = reducedRef.current;
    await sleep(quick ? 120 : 280);

    let sc = levelScore;
    for (const st of steps) {
      const ev = st.event;
      if (ev.type === "merge") {
        const from = G.centers[ev.from], to = G.centers[ev.to];
        const loser = V.tiles[ev.from];
        const ringIdx = loser.rings.length - 1;
        const ring = loser.rings.pop();
        if (!loser.rings.length) delete V.tiles[ev.from];
        const target = V.tiles[ev.to];
        const tring = target.rings[target.rings.length - 1];
        const tRad = ringRad(target.rings.length - 1);
        const sRad = ringRad(ringIdx);
        const approach = Math.atan2(from.y - to.y, from.x - to.x);
        const n = ring.dots.length;
        const t0 = performance.now();
        const dur = quick ? 180 : FLIGHT_MS;
        const stag = quick ? 20 : FLIGHT_STAGGER;
        ring.dots.forEach((d, i) => {
          const x0 = from.x + sRad * Math.cos(d.angle);
          const y0 = from.y + sRad * Math.sin(d.angle);
          const tAng = approach + (i - (n - 1) / 2) * 0.45;
          const x1 = to.x + tRad * Math.cos(tAng);
          const y1 = to.y + tRad * Math.sin(tAng);
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          const len = Math.hypot(x1 - x0, y1 - y0) || 1;
          const bow = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 18);
          V.flights.push({
            color: ring.color,
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
        /* pop: burst the ring */
        const at = G.centers[ev.at];
        const vt = V.tiles[ev.at];
        const ring = vt.rings[vt.rings.length - 1];
        const rad = ringRad(vt.rings.length - 1);
        const t0 = performance.now();
        V.sparks.push({ kind: "ring", x: at.x, y: at.y, r0: rad, color: ring.color, t0, dur: 550 });
        for (const d of ring.dots) {
          const dx = Math.cos(d.angle), dy = Math.sin(d.angle);
          const sp = 80 + Math.random() * 80;
          V.sparks.push({
            kind: "dot", color: ring.color,
            x: at.x + rad * dx, y: at.y + rad * dy,
            vx: dx * sp, vy: dy * sp, t0, dur: 620,
          });
        }
        vt.rings.pop();
        if (!vt.rings.length) delete V.tiles[ev.at];
        V.floats.push({ x: at.x, y: at.y, points: ev.points, color: ev.color, t0 });
        sc += ev.points;
        setLevelScore(sc);
        setTotalScore((t) => t + ev.points);
        await sleep(quick ? 200 : 480);
      }
    }

    if (needRefill) {
      setHand([genTile(S.cfg.numColors), genTile(S.cfg.numColors), genTile(S.cfg.numColors)]);
    }
    if (sc >= S.cfg.threshold) setLevelDone(true);
    else if (S.cfg.cells.every((c) => final[c])) setGameOver(true);
    setAnimating(false);
  }

  /* ---------------- HTML shell ---------------- */

  const progress = Math.min(1, levelScore / cfg.threshold);
  const canPlaceNow = selected !== null && hand[selected] && !animating && !levelDone && !gameOver;

  return (
    <div style={{
      minHeight: "100vh", background: "#0b0f17", color: "#dbe3f0",
      fontFamily: "'Avenir Next','Segoe UI',system-ui,sans-serif",
      display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 12px",
    }}>
      <div style={{ width: "100%", maxWidth: geom.W, display: "flex", alignItems: "baseline",
                    justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: ".08em" }}>
          RING<span style={{ color: "#38bdf8" }}>CHARGE</span>
        </div>
        <div style={{ fontSize: 13, color: "#8fa0b8" }}>
          Level {level} &nbsp;·&nbsp; Total {totalScore}
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: geom.W, marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12,
                      color: "#8fa0b8", marginBottom: 3 }}>
          <span>{levelScore} pts</span><span>goal {cfg.threshold}</span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "#1c2434", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${progress * 100}%`, borderRadius: 4,
            background: "linear-gradient(90deg,#38bdf8,#a78bfa)",
            transition: "width .4s ease",
          }} />
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
              {levelDone ? `Level ${level} charged!` : "Board full"}
            </div>
            <div style={{ color: "#8fa0b8", fontSize: 14 }}>
              {levelDone
                ? `${levelScore} points — goal was ${cfg.threshold}`
                : "No empty poles left to place a tile."}
            </div>
            <button
              onClick={() => {
                if (levelDone) { const nl = level + 1; setLevel(nl); startLevel(nl); }
                else { setLevel(1); setTotalScore(0); startLevel(1); }
              }}
              style={{
                padding: "10px 26px", fontSize: 15, fontWeight: 600, borderRadius: 8,
                border: "none", cursor: "pointer", color: "#0b0f17",
                background: levelDone
                  ? "linear-gradient(90deg,#38bdf8,#a78bfa)"
                  : "#e2e8f0",
              }}>
              {levelDone ? `Start level ${level + 1}` : "New game"}
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 12.5, color: "#657894", textAlign: "center", maxWidth: 460 }}>
        {canPlaceNow
          ? "Click an empty hex to place the tile."
          : "Pick a tile, then place it next to a matching outer ring. Six dots fully charges a ring."}
      </div>
    </div>
  );
}
