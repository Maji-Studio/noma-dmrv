// Journey page: boot, selection lighting, view mode, hash routes and keyboard. The page is one
// screen: a map (or graph) with a record carousel over it. Which module does what is in README.md
// of this folder's siblings; they reach each other through ctx (state.js).
import { CHAIN, HASH, HOME, LATER_RUNS, R } from "./model.js";
import { mount as mountCamera, insets, invalidate, startBlend, linked, onMapMove, onMapUser } from "./camera.js";
import { mount as mountDeck } from "./deck.js";
import { mount as mountGraph } from "./graph.js";
import { mount as mountSheet } from "./sheet.js";
import { mount as mountSummary } from "./summary.js";
import { createJourneyMap } from "./map.js";
import { toMap } from "./geo.js";
import { $, ctx, desk, lvl, st } from "./state.js";

const ZOOM_STEP = 0.68; // zoom levels per press of + or -, about the old 1.6x
const GRAPH_ZOOM = 1.6;
const MODE_BLEND_MS = 520;
const MODE_ZOOM_FROM = 0.82;
const RECENTER_MS = 600;
const RESIZE_MS = 120;
const MAP_WAIT_MS = 12000;
const READY_MS = 2500; // show the map even if tiles are slow
const app = $("app");
let lastLit = null;

/* ---------- lighting: what the selected record touches on the map and in the graph ---------- */
function light() {
  const r = R[lvl().items[st.ai]];
  const cur = new Set(r.mc); const rel = new Set(r.mr); const trail = new Set();
  const root = st.levels[0];
  const rootIdx = st.levels.length === 1 ? st.ai : root.idx;
  for (let i = 0; i < CHAIN.length; i++) {
    if (st.levels.length === 1 ? i >= st.ai : i > rootIdx) break;
    R[CHAIN[i]].mc.forEach((k) => trail.add(k));
  }
  if (st.levels.length > 1) R[CHAIN[rootIdx]].mc.forEach((k) => trail.add(k));
  lastLit = { cur, rel, trail, litCount: [...cur].filter((k) => k.startsWith("f:")).length };
  ctx.map?.setLit(lastLit);
  ctx.graph.light(r, rootIdx);
}

/* ---------- view mode ---------- */
function setMode(m, quiet) {
  if (m === st.mode && !quiet) return;
  st.mode = m;
  $("seg").dataset.mode = m;
  $("tMap").setAttribute("aria-selected", m === "map"); $("tGraph").setAttribute("aria-selected", m === "graph");
  $("mapV").hidden = m !== "map"; $("graphV").hidden = m !== "graph";
  $("zSat").hidden = m !== "map" || !ctx.map?.hasSat;
  $("vnote").textContent = `${LATER_RUNS} later runs grouped`;
  $("vnote").style.visibility = m === "graph" ? "" : "hidden";
  st.free[m] = false;
  if (m === "map") ctx.map?.resize();
  st.cam[m] = linked(m, st.f);
  if (!quiet) { const c = st.cam[m]; st.cam[m] = { cx: c.cx, cy: c.cy, s: c.s * MODE_ZOOM_FROM }; startBlend(m, MODE_BLEND_MS); }
  ctx.dirty(); setHash();
}

/* ---------- hash routes: #graph-full-summary-run-b1x2 ---------- */
function setHash() {
  if (st.booting) return;
  const t = [];
  if (st.mode === "graph") t.push("graph");
  if (st.snap !== "mid" && !desk()) t.push(st.snap);
  if (!$("sum").hidden) t.push("summary");
  const ri = st.levels.length === 1 ? st.ai : st.levels[0].idx;
  t.push(HASH[ri] || "field");
  if (st.levels.length === 2) {
    const bi = R[CHAIN[ri]].br.findIndex((b) => b.label === lvl().label);
    if (bi >= 0) t.push(`b${bi}${st.ai ? `x${st.ai}` : ""}`);
  }
  try { history.replaceState(null, "", `#${t.join("-")}`); } catch { /* a sandboxed frame may refuse */ }
}
function route(h) {
  const t = h.replace(/^#/, "").split("-").filter(Boolean);
  const mode = t.includes("graph") ? "graph" : "map";
  const snap = t.includes("full") ? "full" : t.includes("low") ? "low" : "mid";
  let si = HOME;
  t.forEach((x) => { const i = HASH.indexOf(x); if (i >= 0) si = i; });
  const bt = t.find((x) => /^b\d/.test(x));
  st.levels = [{ items: CHAIN, idx: si, label: "Chain" }];
  ctx.enterLevel(0);
  if (bt) {
    const [, bi, xi] = bt.match(/^b(\d+)(?:x(\d+))?/);
    const br = R[CHAIN[si]].br[+bi];
    if (br) { ctx.openBranch(CHAIN[si], br); if (xi) ctx.scrollToIdx(+xi, false); }
  }
  st.snap = snap; ctx.applySnap(false); setMode(mode, true);
  if (t.includes("summary") || t.includes("batch")) ctx.openSum(true); // "batch" was a chain step before
}

/* ---------- controls ---------- */
function controls() {
  $("tMap").addEventListener("click", () => setMode("map"));
  $("tGraph").addEventListener("click", () => setMode("graph"));
  $("seg").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault(); setMode(st.mode === "map" ? "graph" : "map"); $(st.mode === "map" ? "tMap" : "tGraph").focus();
  });
  const zoom = (k) => {
    if (st.mode === "map") { ctx.map?.zoomBy(Math.log2(k)); return; }
    const I = insets();
    ctx.graph.zoomAt(k, I.l + (st.VW - I.l - I.r) / 2, I.t + (st.VH - I.t - I.b) / 2);
  };
  $("zIn").addEventListener("click", () => zoom(2 ** ZOOM_STEP)); $("zOut").addEventListener("click", () => zoom(2 ** -ZOOM_STEP));
  $("zSat").addEventListener("click", () => {
    const on = $("zSat").getAttribute("aria-pressed") !== "true";
    $("zSat").setAttribute("aria-pressed", String(on));
    ctx.map?.setSat(on);
  });
  $("zRe").addEventListener("click", () => { startBlend(st.mode, RECENTER_MS); ctx.dirty(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("sum").hidden) ctx.openSum(false);
      else if (st.levels.length > 1) ctx.popTo(st.levels.length - 2);
      else if (st.snap === "full") ctx.setSnap("mid");
      return;
    }
    if (e.target.closest?.("input,textarea,.rail,.seg,.maplibregl-canvas")) return;
    if (e.key === "ArrowRight" && !e.metaKey) ctx.go(st.ai + 1);
    else if (e.key === "ArrowLeft" && !e.metaKey) ctx.go(st.ai - 1);
  });
  // Watch the page box, not window resize: iOS Safari can hand over a page opened from a QR scan
  // at its final size without a resize event, which left the sheet and cameras fitted to the old size.
  // The size this handler last laid out at, kept apart from st.VW/VH, which layoutDeck also writes.
  let rz = 0; let laidW = app.clientWidth; let laidH = app.clientHeight;
  new ResizeObserver(() => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (app.clientWidth === laidW && app.clientHeight === laidH) return;
      laidW = app.clientWidth; laidH = app.clientHeight;
      const keep = st.ai; const wasDesk = $("deck").dataset.desk === "1";
      $("deck").dataset.desk = desk() ? "1" : "0";
      if (wasDesk !== desk()) ctx.buildDeck(0); else ctx.layoutDeck();
      ctx.buildRail(); ctx.scrollToIdx(keep, false); st.ai = -1; st.f = keep;
      invalidate(false);
      for (const m of ["map", "graph"]) st.blend[m] = null;
      ctx.dirty();
    }, RESIZE_MS);
  }).observe(app);
  addEventListener("hashchange", () => route(location.hash));
}

/* ---------- the map arrives after first paint; the cards and graph work without it ---------- */
async function startMap() {
  const host = $("mapV");
  const handle = await Promise.race([
    createJourneyMap(host, { onPick: (id) => ctx.goRecord(id), onUser: onMapUser, onMove: onMapMove }),
    new Promise((resolve) => setTimeout(() => resolve(null), MAP_WAIT_MS)),
  ]).catch(() => null);
  if (!handle) {
    app.classList.add("no-map");
    if (st.mode === "map" && !location.hash.includes("map")) setMode("graph");
    return;
  }
  ctx.map = handle;
  $("zSat").hidden = st.mode !== "map" || !handle.hasSat;
  handle.setCamera(toMap(st.cam.map || linked("map", st.f)));
  if (lastLit) handle.setLit(lastLit);
  handle.map.once("idle", () => handle.ready());
  setTimeout(() => handle.ready(), READY_MS);
  ctx.dirty();
}

export function boot() {
  mountCamera(); mountSheet(); mountDeck(); mountGraph(); mountSummary();
  Object.assign(ctx, { light, setHash, setMode });
  st.VW = app.clientWidth; st.VH = app.clientHeight;
  $("deck").dataset.desk = desk() ? "1" : "0";
  controls();
  route(location.hash || "");
  invalidate(false);
  for (const m of ["map", "graph"]) { st.blend[m] = null; st.cam[m] = linked(m, st.f); }
  if (st.mode === "graph") ctx.graph.draw(st.cam.graph);
  st.booting = false;
  ctx.dirty();
  startMap();
}
