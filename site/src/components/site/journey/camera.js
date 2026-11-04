// Journey page: cameras. Every card has a fitted camera for the map and one for the graph; the
// carousel's scroll position blends between neighbours, so the view follows a swipe. A visitor's own
// pan or zoom takes over ("free") until the next card is chosen or Recenter is pressed.
import { GRAPH, HERO, J, PLANT, R, gPos } from "./model.js";
import { clamp } from "./format.js";
import { ease, fit, fromMap, interpZoom, scaleFor, toMap } from "./geo.js";
import { RM, ctx, desk, lvl, st } from "./state.js";

const PLANT_ZOOM = 10.6; // plant steps: the schematic sits over the plant at this zoom
const PLANT_S = scaleFor(PLANT_ZOOM, J.facility.lat);
const BLEND_MS = 520;
const MIN_NODE_S = 0.55;
const MAX_NODE_S = 1.3;
const INSET = { l: 58, r: 66, t: 100, below: 44 };
const DESK_INSET = { l: 48, r: 420 + 90, t: 104, b: 56 };

export function insets() {
  if (desk()) return DESK_INSET;
  return { l: INSET.l, r: INSET.r, t: INSET.t, b: ctx.sheetVisible() + INSET.below };
}

const tile = () => ({ at: PLANT, s: PLANT_S, plant: true });
const SUPS_GEO = () => [R[HERO.sup].geo];
/** Where the map looks for a card. main: the card is on the selected chain, not a branch. */
export function mapTarget(id, main) {
  const r = R[id];
  switch (r.k) {
    case "sup": return { pts: [r.geo, PLANT], pad: 2.2, max: 40 };
    case "fs": return { pts: [...Object.values(R).filter((x) => x.k === "sup").map((x) => x.geo), PLANT], pad: 1.6, max: 40 };
    case "fbin": case "bbin": case "smp": return tile();
    case "run": return main || !r.fields.length ? tile() : { pts: [PLANT, ...r.fields.map((f) => R[f].geo)], pad: 3, max: 50 };
    case "prod": return main || !r.field ? tile() : { pts: [PLANT, R[r.field].geo], pad: 3, max: 50 };
    case "del": return { pts: [PLANT, R[r.field].geo], pad: 4, max: 40 };
    case "app": return main ? { pts: [r.geo, PLANT, ...SUPS_GEO()], pad: 3, max: 30 } : { pts: [r.geo], pad: 7, max: 30 };
    case "cb": return r.fields.length ? { pts: [PLANT, ...r.fields.map((f) => R[f].geo)], pad: 3, max: 40 } : tile();
    default: return tile();
  }
}
export function graphTarget(id) {
  const p = gPos.get(R[id].g);
  return { at: { x: p.x, y: p.y }, s: "node" };
}
const graphScale = (aw) => clamp(aw / (GRAPH.pitch * (desk() ? 4.2 : 2.2)), MIN_NODE_S, MAX_NODE_S);
export function graphAll() {
  return fit({ pts: [{ x: 0, y: 0 }, { x: GRAPH.W, y: GRAPH.H }], pad: 0, max: 3 }, insets(), st.VW, st.VH, graphScale);
}
/** 0 or 1: does this card show the plant schematic? */
export const plantWeightOf = (id, main) => (mapTarget(id, main).plant ? 1 : 0);

function levelCams(mode) {
  if (st.cams[mode]) return st.cams[mode];
  const L = lvl();
  const main = st.levels.length === 1;
  const I = insets();
  st.cams[mode] = L.items.map((id) => fit(mode === "map" ? mapTarget(id, main) : graphTarget(id), I, st.VW, st.VH, graphScale));
  st.zi[mode] = [];
  return st.cams[mode];
}
const viewW = () => Math.max(1, st.VW - insets().l - insets().r);
export function linked(mode, f) {
  const C = levelCams(mode);
  const n = C.length;
  f = clamp(f, 0, n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const u = f - i;
  if (n === 1 || u < 1e-4) return C[Math.round(f)];
  if (u > 1 - 1e-4) return C[i + 1];
  const z = st.zi[mode][i] || (st.zi[mode][i] = interpZoom(C[i], C[i + 1], viewW()));
  return z(u);
}
/** Plant schematic weight at card position f (blends across a swipe). */
export function plantWeight(f) {
  const L = lvl();
  const main = st.levels.length === 1;
  const n = L.items.length;
  const i = clamp(Math.floor(f), 0, n - 1);
  const j = Math.min(n - 1, i + 1);
  const u = clamp(f - i, 0, 1);
  const a = plantWeightOf(L.items[i], main);
  const b = plantWeightOf(L.items[j], main);
  return a + (b - a) * ease(u);
}
export function startBlend(mode, dur) {
  if (!st.cam[mode]) return;
  st.blend[mode] = { from: { ...st.cam[mode] }, t0: performance.now(), dur: RM() ? 0 : dur };
  st.free[mode] = false;
}
/** Cards or insets changed: refit. blend flies there from where the camera is now. */
export function invalidate(blend) {
  for (const m of ["map", "graph"]) {
    if (blend && st.cam[m]) startBlend(m, BLEND_MS);
    st.cams[m] = null;
    st.zi[m] = [];
  }
  ctx.dirty();
}
function camFor(mode, now) {
  if (st.free[mode]) return st.cam[mode];
  const lk = linked(mode, st.f);
  const b = st.blend[mode];
  if (b) {
    const t = b.dur ? Math.min(1, (now - b.t0) / b.dur) : 1;
    if (t >= 1) { st.blend[mode] = null; return lk; }
    return interpZoom(b.from, lk, viewW())(ease(t));
  }
  return lk;
}

/* ---------- frame loop ---------- */
let raf = 0;
export function dirty() { if (!raf) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0;
  const f = st.f;
  ctx.setActive(Math.round(f));
  ctx.cardFx(f);
  ctx.railFx(f);
  const m = st.mode;
  const cam = camFor(m, now);
  if (m === "map") {
    if (!st.free.map) st.cam.map = cam;
    if (ctx.map) {
      if (!st.free.map) ctx.map.setCamera(toMap(cam));
      ctx.map.setPlantWeight(plantWeight(f));
    }
  } else {
    st.cam.graph = cam;
    ctx.graph.draw(cam);
  }
  if (st.blend[m]) raf = requestAnimationFrame(frame);
}
/** The map moved under the visitor's hand: remember where, so Recenter can fly back from there. */
export function onMapMove() { if (st.free.map && ctx.map) st.cam.map = fromMap(ctx.map.map); }
export function onMapUser() { st.free.map = true; st.blend.map = null; }
export function mount() {
  Object.assign(ctx, { dirty, invalidate, startBlend, insets, linked, graphAll, onMapMove, onMapUser });
}
