// Graph engine for the interactive trace (src/components/site/trace/).
// Ported from the prototype linked in docs/archive/plans/2026-09-29-landing-page.md.
export const NS = "http://www.w3.org/2000/svg";
export const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

export const STAGES = {
  sup: { label: "Supplier", plural: "suppliers", dom: "infra", g: "M8 2.5l5 7.5H3z M8 10v3.5" },
  fd: { label: "Feedstock delivery", plural: "deliveries in", dom: "prod", g: "M1.8 5h7.4v6H1.8z M9.2 7.4h2.9l2.1 2.1V11H9.2 M4 13h.01 M11.5 13h.01" },
  fbin: { label: "Feedstock bin", plural: "feedstock bins", dom: "prod", g: "M3 5h10l-1.2 8.5H4.2z M2.2 5h11.6" },
  ing: { label: "Ingredient bin", plural: "ingredient bins", dom: "infra", g: "M3.5 12.5C3.5 6.5 7 3.5 12.5 3.5c0 5.5-3 9-9 9z M3.5 12.5l5-5" },
  run: { label: "Production run", plural: "runs", dom: "prod", g: "M8 2.2c2 2.8 4 4.2 4 7a4 4 0 0 1-8 0c0-1.8 1-3 2-3.8.1 1.6.9 2.6 2 2.8-.3-2.1-.6-4 0-6z" },
  bbin: { label: "Biochar bin", plural: "biochar bins", dom: "prod", g: "M2.5 4.5h11 M2.5 8h11 M2.5 11.5h11" },
  prod: { label: "Biochar product", plural: "products", dom: "dist", g: "M8 2.8a5.2 5.2 0 1 0 .01 0z M8 2.8v10.4" },
  del: { label: "Delivery out", plural: "deliveries out", dom: "dist", g: "M1.8 5h7.4v6H1.8z M9.2 7.4h2.9l2.1 2.1V11H9.2 M4 13h.01 M11.5 13h.01" },
  app: { label: "Application", plural: "fields", dom: "dist", g: "M2 13h12 M3 10h10 M4.5 7h7 M6 4h4" },
  cb: { label: "Credit batch", plural: "credit batches", dom: "ver", g: "M3 3h10v10H3z M5.4 8.2l1.9 1.9 3.3-4" },
  smp: { label: "Lab sample", plural: "samples", dom: "ver", g: "M6 2.2h4 M7 2.2v4l-3.6 6.8h9.2L9 6.2v-4" },
  rem: { label: "Removal", plural: "removals", dom: "ver", g: "M8 2l5.5 2.5v3.8c0 3-2.6 5-5.5 5.7-2.9-.7-5.5-2.7-5.5-5.7V4.5z M5.6 8.3l1.7 1.7 3-3.6" },
  plant: { label: "Plant", plural: "plants", dom: "prod", g: "M2.5 13.5V7l3.5 2.2V7l3.5 2.2V3.5h4v10z" },
};

export function makeGraph(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n])), out = new Map(), inn = new Map();
  nodes.forEach((n) => { out.set(n.id, []); inn.set(n.id, []); });
  edges.forEach(([a, b]) => { out.get(a).push(b); inn.get(b).push(a); });
  return { nodes, edges, byId, out, inn };
}
/** Breadth-first walk in one direction only, so siblings never light up. */
export function walk(g, start, dir) {
  const adj = dir === "up" ? g.inn : g.out, seen = new Set([start]), q = [start];
  while (q.length) { const c = q.shift(); for (const n of adj.get(c) || []) if (!seen.has(n)) { seen.add(n); q.push(n); } }
  seen.delete(start);
  return seen;
}
export function drawGraph(svg, g, opt) {
  svg.innerHTML = "";
  const eG = el("g", {}, svg), nG = el("g", {}, svg), s = opt.size;
  g.edgeEls = g.edges.map(([a, b]) => {
    const A = g.byId.get(a), B = g.byId.get(b);
    const x1 = A.x + s / 2, y1 = A.y, x2 = B.x - s / 2, y2 = B.y, mx = (x1 + x2) / 2;
    const p = el("path", { class: "nv-edge", d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` }, eG);
    p._a = a; p._b = b;
    return p;
  });
  g.nodeEls = new Map();
  g.nodes.forEach((n) => {
    const st = STAGES[n.st];
    const gg = el("g", { class: `nv-node d-${st.dom}`, transform: `translate(${n.x - s / 2},${n.y - s / 2})`, "data-id": n.id, tabindex: opt.focusable ? "0" : "-1", role: "button", "aria-label": `${st.label} ${n.code}` }, nG);
    el("rect", { class: "nv-hit", x: -6, y: -6, width: s + 12, height: s + 12 }, gg);
    el("rect", { class: "nv-body", width: s, height: s, rx: Math.max(1.5, s * 0.12) }, gg);
    if (opt.glyphs) { const k = (s - 4) / 16; el("path", { class: "nv-glyph", d: st.g, transform: `translate(2,2) scale(${k})`, "stroke-width": (1.4 / k) * Math.min(1, k * 1.1) }, gg); }
    if (opt.labels) {
      const t = el("text", { x: s / 2, y: s + 14, "text-anchor": "middle" }, gg); t.textContent = n.code;
      const t2 = el("text", { class: "nv-st", x: s / 2, y: s + 26, "text-anchor": "middle" }, gg); t2.textContent = n.short || st.label;
    }
    g.nodeEls.set(n.id, gg);
  });
}
export function highlight(svg, g, id) {
  if (!id) {
    svg.classList.remove("nv-hl");
    g.nodeEls.forEach((e) => e.classList.remove("on", "self"));
    g.edgeEls.forEach((e) => e.classList.remove("on"));
    return;
  }
  const up = walk(g, id, "up"), dn = walk(g, id, "down");
  up.add(id); dn.add(id);
  svg.classList.add("nv-hl");
  g.nodeEls.forEach((e, k) => { e.classList.toggle("on", up.has(k) || dn.has(k)); e.classList.toggle("self", k === id); });
  g.edgeEls.forEach((e) => {
    const on = (up.has(e._a) && up.has(e._b)) || (dn.has(e._a) && dn.has(e._b));
    e.classList.toggle("on", on);
    if (on) e.parentNode.appendChild(e);
  });
}
