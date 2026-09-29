// Trace visuals: simple chain (A), dense six-week graph (B), map (C).
import { STAGES, countsHtml, detailHtml, drawGraph, el, esc, makeGraph, rng, walk, wire } from "./core.js";
import { CHAIN_EDGES, CHAIN_NODES, PLANT, denseGraph } from "./data.js";

const LEGEND = `<div class="nv-legend"><span><i class="lg-infra"></i>Supplier, ingredient</span><span><i class="lg-prod"></i>Production and stock</span><span><i class="lg-dist"></i>Product and distribution</span><span><i class="lg-ver"></i>Verification</span></div>`;

/** Builds the frame: svg in a scroll box, optional legend, optional side panel. */
function frame(root, { viewBox, minWidth, label }) {
  const side = root.dataset.side || "right";
  const legend = root.dataset.legend !== "false";
  root.classList.add("nv-viz", `nv-side-${side}`);
  root.innerHTML = `<div class="nv-main"><div class="nv-scroll"><svg viewBox="${viewBox}" style="min-width:${minWidth}px" role="group" aria-label="${esc(label)}"></svg></div>${legend ? LEGEND : ""}</div>${side === "none" ? "" : `<aside class="nv-side" aria-live="polite"></aside>`}`;
  return { svg: root.querySelector("svg"), sideEl: root.querySelector(".nv-side") };
}
function emit(root, g, id) {
  root.dispatchEvent(new CustomEvent("noma:select", { bubbles: true, detail: { id, node: id ? g.byId.get(id) : null } }));
}

const CHAIN_IDLE = `<div class="nv-stage">How to read it</div><p>Fourteen records behind one removal. Hover the field (AP-2026-031): the whole chain back to the sawmill lights up, plus the manure that went into the blend.</p><p class="nv-hint">1,000 kg feedstock at 20% moisture gives 300 kg biochar at 10%, so 270 kg dry.</p>`;
export function mountChain(root) {
  const { svg, sideEl } = frame(root, { viewBox: "0 0 1010 300", minWidth: 760, label: "Chain of custody for one removal" });
  const g = makeGraph(CHAIN_NODES.map((n) => ({ ...n })), CHAIN_EDGES);
  drawGraph(svg, g, { size: 30, glyphs: true, labels: true, focusable: true });
  if (sideEl) sideEl.innerHTML = CHAIN_IDLE;
  return wire(svg, g, (id) => { if (sideEl) sideEl.innerHTML = id ? detailHtml(g, id) : CHAIN_IDLE; emit(root, g, id); });
}

const DENSE_IDLE = `<div class="nv-stage">How to read it</div><p>One plant, six weeks: 7 suppliers, 28 deliveries in, 18 runs, 8 biochar bins, 20 products, 45 fields, 5 removals.</p><p>Hover a <b>mix bin</b> (Bin B, D or E) to see how far one merge reaches. Hover a <b>field</b> to walk it back to the sawmills.</p><p class="nv-hint">Made-up data. Bottom row: credit batches and lab samples.</p>`;
export function mountDense(root) {
  const { svg, sideEl } = frame(root, { viewBox: "0 0 1200 700", minWidth: 820, label: "Chain of custody, six weeks of records" });
  const src = denseGraph();
  const g = makeGraph(src.nodes.map((n) => ({ ...n })), src.edges);
  const glyphs = root.dataset.style !== "dots";
  drawGraph(svg, g, { size: glyphs ? 15 : 8, glyphs, labels: false, focusable: false });
  const t = el("text", { x: 470, y: 598, class: "nv-town" }, svg); t.textContent = "Credit batches and lab samples";
  if (sideEl) sideEl.innerHTML = DENSE_IDLE;
  const ctl = wire(svg, g, (id) => { if (sideEl) sideEl.innerHTML = id ? detailHtml(g, id) : DENSE_IDLE; emit(root, g, id); });
  if (root.dataset.jump === "true") {
    const sel = document.createElement("select");
    sel.className = "nv-jump"; sel.setAttribute("aria-label", "Trace from a record");
    sel.innerHTML = `<option value="">Trace from…</option>` + [["Removals", "rem"], ["Mix bins", "bbin"], ["Credit batches", "cb"]].map(([lab, st]) => `<optgroup label="${lab}">${g.nodes.filter((n) => n.st === st && (st !== "bbin" || n.mode === "mix")).map((n) => `<option value="${n.id}">${esc(n.code)}</option>`).join("")}</optgroup>`).join("");
    sel.addEventListener("change", () => ctl.pin(sel.value));
    root.querySelector(".nv-main").prepend(sel);
  }
  return ctl;
}

const MAPB = { lng0: 33.1, lng1: 36.2, lat0: -7.45, lat1: -9.55, W: 1000, H: 680 };
const P = (lat, lng) => [((lng - MAPB.lng0) / (MAPB.lng1 - MAPB.lng0)) * MAPB.W, ((lat - MAPB.lat0) / (MAPB.lat1 - MAPB.lat0)) * MAPB.H];
const TOWNS = [["Iringa", -7.77, 35.69], ["Mafinga", -8.3, 35.28], ["Makambako", -8.85, 34.83], ["Mbeya", -8.91, 33.46], ["Njombe", -9.33, 34.77]];
const MAP_IDLE = `<div class="nv-stage">How to read it</div><p>The same records, placed where they happened. Everything inside the plant collapses into one square.</p><p>Hover a <b>field</b> to see which sawmills its biochar came from. Hover a <b>sawmill</b> to see every field it ended up in.</p>`;
export function mountMap(root) {
  root.dataset.legend = root.dataset.legend || "false";
  const { svg, sideEl } = frame(root, { viewBox: "0 0 1000 680", minWidth: 680, label: "Chain of custody on a map of the Southern Highlands, Tanzania" });
  const dense = denseGraph();
  el("rect", { class: "nv-land", x: 0, y: 0, width: 1000, height: 680 }, svg);
  const r = rng(7), cg = el("g", {}, svg);
  [[-8.6, 34.6, 1], [-8.2, 35.6, 0.8], [-9.1, 33.9, 0.7]].forEach(([la, ln, sc]) => {
    const [cx, cy] = P(la, ln);
    for (let k = 1; k <= 6; k++) {
      let d = ""; const R = k * 34 * sc, ph = r() * 6;
      for (let a = 0; a <= 64; a++) { const t = (a / 64) * Math.PI * 2, rr = R * (1 + 0.18 * Math.sin(3 * t + ph) + 0.08 * Math.sin(5 * t + ph * 2)); d += (a ? "L" : "M") + (cx + rr * Math.cos(t) * 1.3).toFixed(1) + "," + (cy + rr * Math.sin(t)).toFixed(1); }
      el("path", { class: "nv-contour", d: d + "Z" }, cg);
    }
  });
  const road = (pts) => el("path", { class: "nv-road", d: pts.map((p, i) => (i ? "L" : "M") + P(p[0], p[1]).join(",")).join("") }, svg);
  road([[-7.77, 35.69], [-8.3, 35.28], [-8.85, 34.83], [-8.91, 33.46]]); road([[-8.85, 34.83], [-9.33, 34.77]]);
  TOWNS.forEach(([n, la, ln]) => { const [x, y] = P(la, ln); el("circle", { cx: x, cy: y, r: 2.5, class: "nv-town-dot" }, svg); const t = el("text", { x: x + 7, y: y - 7, class: "nv-town" }, svg); t.textContent = n; });
  const plant = { id: "plant", st: "plant", code: "Mafinga plant", meta: ["All production, bins and blending happen here", "18 runs, 8 biochar bins"], lat: PLANT.lat, lng: PLANT.lng };
  const sups = dense.nodes.filter((n) => n.st === "sup"), apps = dense.nodes.filter((n) => n.st === "app");
  const nodes = [plant, ...sups, ...apps].map((n) => { const [x, y] = P(n.lat, n.lng); return { ...n, x, y }; });
  const mg = makeGraph(nodes, [...sups.map((s) => [s.id, "plant"]), ...apps.map((a) => ["plant", a.id])]);
  const arcG = el("g", {}, svg), nG = el("g", {}, svg);
  const arcs = mg.edges.map(([a, b]) => {
    const A = mg.byId.get(a), B = mg.byId.get(b), dx = B.x - A.x, dy = B.y - A.y;
    const p = el("path", { class: "nv-arc" + (a === "plant" ? "" : " up"), d: `M${A.x},${A.y} Q${(A.x + B.x) / 2 - dy * 0.2},${(A.y + B.y) / 2 + dx * 0.2} ${B.x},${B.y}` }, arcG);
    p._a = a; p._b = b; return p;
  });
  const nEls = new Map();
  mg.nodes.forEach((n) => {
    const st = STAGES[n.st], s = n.st === "plant" ? 26 : n.st === "sup" ? 15 : 11;
    const g = el("g", { class: `nv-node d-${st.dom}`, transform: `translate(${n.x - s / 2},${n.y - s / 2})`, "data-id": n.id, role: "button", tabindex: n.st === "app" ? "-1" : "0", "aria-label": `${st.label} ${n.code}` }, nG);
    el("rect", { class: "nv-hit", x: -5, y: -5, width: s + 10, height: s + 10 }, g);
    el("rect", { class: "nv-body", width: s, height: s, rx: 2 }, g);
    if (s >= 15) { const k = (s - 4) / 16; el("path", { class: "nv-glyph", d: st.g, transform: `translate(2,2) scale(${k})`, "stroke-width": 1.4 / k }, g); }
    if (n.st === "plant") { const t = el("text", { x: s + 6, y: s / 2 + 4 }, g); t.textContent = "Plant"; }
    nEls.set(n.id, g);
  });
  const lineage = (id) => {
    if (id === "plant") return { sups: new Set(sups.map((s) => s.id)), apps: new Set(apps.map((a) => a.id)) };
    const n = dense.byId.get(id);
    if (n.st === "sup") return { sups: new Set([id]), apps: new Set([...walk(dense, id, "down")].filter((x) => dense.byId.get(x).st === "app")) };
    const all = new Set([...walk(dense, id, "up"), ...walk(dense, id, "down"), id]);
    return { sups: new Set([...all].filter((x) => dense.byId.get(x).st === "sup")), apps: new Set([...all].filter((x) => dense.byId.get(x).st === "app")) };
  };
  let pinned = null;
  const show = (id) => {
    root.dispatchEvent(new CustomEvent("noma:select", { bubbles: true, detail: { id, node: id ? mg.byId.get(id) || dense.byId.get(id) : null } }));
    if (!id) { svg.classList.remove("nv-hl"); nEls.forEach((e) => e.classList.remove("on", "self")); arcs.forEach((a) => a.classList.remove("on")); if (sideEl) sideEl.innerHTML = MAP_IDLE; return; }
    const L = lineage(id); svg.classList.add("nv-hl");
    nEls.forEach((e, k) => { e.classList.toggle("on", k === "plant" || L.sups.has(k) || L.apps.has(k)); e.classList.toggle("self", k === id); });
    arcs.forEach((a) => a.classList.toggle("on", (L.sups.has(a._a) && a._b === "plant") || (a._a === "plant" && L.apps.has(a._b))));
    if (!sideEl) return;
    const n = mg.byId.get(id) || dense.byId.get(id);
    const supNames = [...L.sups].map((s) => dense.byId.get(s).code);
    const extra = id === "plant" ? "" : `<div class="nv-group"><div class="nv-label">${n.st === "sup" ? "Went to" : "Biochar and blend from"}</div><div class="nv-counts">${n.st === "sup" ? `<span>${L.apps.size} fields</span>` : supNames.map((s) => `<span>${esc(s)}</span>`).join("")}</div></div>`;
    sideEl.innerHTML = `<div><div class="nv-stage">${esc(STAGES[n.st].label)}</div><div class="nv-code">${esc(n.code)}</div></div><div class="nv-meta">${(n.meta || []).map((m) => `<div>${esc(m)}</div>`).join("")}</div>${extra}` + (dense.byId.get(id) ? `<div class="nv-group"><div class="nv-label">Full lineage</div>${countsHtml(dense, new Set([...walk(dense, id, "up"), ...walk(dense, id, "down")]))}</div>` : "");
  };
  const idOf = (t) => { const n = t && t.closest && t.closest("[data-id]"); return n ? n.getAttribute("data-id") : null; };
  svg.addEventListener("pointerover", (e) => { const id = idOf(e.target); if (id && !pinned) show(id); });
  svg.addEventListener("pointerout", (e) => { const id = idOf(e.target); if (id && !pinned && !idOf(e.relatedTarget || document.body)) show(null); });
  svg.addEventListener("click", (e) => { const id = idOf(e.target); if (!id) { pinned = null; show(null); return; } pinned = pinned === id ? null : id; show(pinned || id); });
  svg.addEventListener("focusin", (e) => { const id = idOf(e.target); if (id && e.target.matches(":focus-visible")) { pinned = id; show(id); } });
  svg.addEventListener("keydown", (e) => { if (e.key === "Escape") { pinned = null; show(null); } });
  if (sideEl) sideEl.innerHTML = MAP_IDLE;
  return { pin(id) { pinned = id || null; show(pinned); }, clear() { pinned = null; show(null); } };
}
