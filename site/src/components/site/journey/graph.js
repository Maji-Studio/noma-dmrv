// Journey page: the lineage graph, an SVG canvas with its own pan, pinch and wheel handling.
// Columns are record kinds in chain order; edges are the snapshot's graph edges.
import { CHAIN, CHAIN_G, COUNTS, GL, GRAPH, KIND, ORDER, R, gEdges, gLabel, gNodes, gPos, gToRec, isDash, walk } from "./model.js";
import { clamp } from "./format.js";
import { $, ctx, mk, st } from "./state.js";

const MIN_S = 0.3;
const MAX_S = 4;
const TAP_PX = 6;
const WHEEL_K = 0.0022;
const PINCH_WHEEL_K = 0.01;
const gw = $("gw");
const GEL = new Map(); // node id -> <g>
const GEDGE = [];

function build() {
  const gH = $("gH"); const gE = $("gE"); const gN = $("gN");
  ORDER.forEach((k, i) => {
    const x = GRAPH.edge + i * GRAPH.pitch;
    mk("text", { class: "col-h", x, y: 26, "text-anchor": "middle" }, gH).textContent = KIND[k][0].toUpperCase();
    const n = mk("text", { class: "col-h n", x, y: 40, "text-anchor": "middle" }, gH);
    n.textContent = `${COUNTS[k]} ${COUNTS[k] === 1 ? "RECORD" : "RECORDS"}`;
  });
  for (const e of gEdges) {
    const A = gPos.get(e.a); const B = gPos.get(e.b);
    const x1 = A.x + A.s / 2; const x2 = B.x - B.s / 2; const mx = (x1 + x2) / 2;
    const p = mk("path", { class: `e${isDash(e) ? " dash" : ""}`, d: `M${x1},${A.y} C${mx},${A.y} ${mx},${B.y} ${x2},${B.y}` }, gE);
    p._e = e;
    GEDGE.push(p);
  }
  for (const n of gNodes) {
    const q = gPos.get(n.id); const s = q.s;
    const g = mk("g", { class: `n d-${KIND[n.st][1]}`, transform: `translate(${q.x - s / 2},${q.y - s / 2})`, "data-id": n.id }, gN);
    mk("rect", { class: "hit", x: -12, y: -10, width: s + 24, height: s + 26 }, g);
    mk("rect", { class: "halo", x: -7, y: -7, width: s + 14, height: s + 14 }, g);
    if (n.id.startsWith("agg")) { mk("rect", { class: "stack", x: 4, y: -4, width: s, height: s }, g); mk("rect", { class: "stack", x: 2, y: -2, width: s, height: s }, g); }
    mk("rect", { class: "body", width: s, height: s }, g);
    const k = (s - 6) / 16;
    mk("path", { class: "glyph", d: GL[n.st], transform: `translate(3,3) scale(${k})`, "stroke-width": 1.3 / k }, g);
    mk("rect", { class: "ring", x: -4, y: -4, width: s + 8, height: s + 8 }, g);
    mk("text", { class: "lbl", x: s / 2, y: s + 13, "text-anchor": "middle" }, g).textContent = gLabel(n);
    GEL.set(n.id, g);
  }
}

function draw(c) {
  const tx = st.VW / 2 - c.cx * c.s; const ty = st.VH / 2 - c.cy * c.s;
  gw.setAttribute("transform", `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${c.s.toFixed(4)})`);
}

/** Light the selected record, the path walked so far and everything it touches. */
function light(rec, rootIdx) {
  const gid = rec.g;
  const up = walk(gid, "up"); const dn = walk(gid, "down");
  const trail = new Set();
  const chainIdx = st.levels.length === 1 ? st.ai : rootIdx;
  CHAIN.slice(0, chainIdx + (st.levels.length > 1 ? 1 : 0)).forEach((c) => trail.add(R[c].g));
  if (chainIdx >= 1) CHAIN_G.forEach((id) => { if (id.startsWith("FS-")) trail.add(id); });
  GEL.forEach((g, nid) => {
    const cur = nid === gid;
    g.classList.toggle("cur", cur);
    g.classList.toggle("trail", !cur && trail.has(nid));
    g.classList.toggle("rel", !cur && !trail.has(nid) && (up.has(nid) || dn.has(nid)));
  });
  for (const p of GEDGE) {
    const e = p._e;
    const onLine = (up.has(e.a) && up.has(e.b)) || (dn.has(e.a) && dn.has(e.b));
    const tr = trail.has(e.a) && (trail.has(e.b) || e.b === gid);
    const cu = (e.a === gid && dn.has(e.b) && CHAIN_G.has(e.b)) || (e.b === gid && CHAIN_G.has(e.a) && trail.has(e.a));
    p.classList.toggle("cur", cu); p.classList.toggle("trail", !cu && tr); p.classList.toggle("rel", !cu && !tr && onLine);
    if (cu || tr || onLine) p.parentNode.appendChild(p); // lit edges draw on top
  }
}

/* ----- pan, pinch, wheel, tap ----- */
const ptrs = new Map();
let pinch = null;
function gestures() {
  const v = $("graphV");
  const zoomAt = (k, sx, sy) => {
    const c = st.cam.graph; const s = clamp(c.s * k, MIN_S, MAX_S);
    const wx = c.cx + (sx - st.VW / 2) / c.s; const wy = c.cy + (sy - st.VH / 2) / c.s;
    st.cam.graph = { cx: wx - (sx - st.VW / 2) / s, cy: wy - (sy - st.VH / 2) / s, s };
    st.free.graph = true; st.blend.graph = null; ctx.dirty();
  };
  v._zoomAt = zoomAt;
  v.addEventListener("pointerdown", (e) => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    v.setPointerCapture(e.pointerId);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
  });
  v.addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const px = p.x; const py = p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y); const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
      const c = st.cam.graph;
      st.cam.graph = { cx: c.cx - (mx - pinch.mx) / c.s, cy: c.cy - (my - pinch.my) / c.s, s: c.s };
      zoomAt(d / pinch.d, mx, my); pinch = { d, mx, my }; p.moved = true; return;
    }
    if (ptrs.size === 1 && (p.moved || Math.hypot(p.x - p.x0, p.y - p.y0) > TAP_PX)) {
      p.moved = true;
      const c = st.cam.graph;
      st.cam.graph = { cx: c.cx - (p.x - px) / c.s, cy: c.cy - (p.y - py) / c.s, s: c.s };
      st.free.graph = true; st.blend.graph = null; ctx.dirty();
    }
  });
  const up = (e) => {
    const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (!p || p.moved || e.type === "pointercancel") return;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".n");
    if (hit) ctx.goRecord(gToRec(hit.dataset.id));
  };
  v.addEventListener("pointerup", up); v.addEventListener("pointercancel", up);
  v.addEventListener("wheel", (e) => {
    e.preventDefault();
    const b = $("app").getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? PINCH_WHEEL_K : WHEEL_K)), e.clientX - b.left, e.clientY - b.top);
  }, { passive: false });
}

export function mount() {
  build();
  gestures();
  ctx.graph = { draw, light, zoomAt: (k, x, y) => $("graphV")._zoomAt(k, x, y) };
}

