// Interactive trace: hover previews a record's path, click or keyboard pins it, the select mirrors it.
// Edges draw in on first view; a pinned record lights its path outward from itself.
import { drawGraph, highlight, walk, esc, STAGES } from "../../../visuals/core.js";
import { onFirstView, reducedMotion } from "../motion.js";
import { LAYOUT, DEFAULT_RECORD, GRAPHS } from "./trace-data.js";

const DRAW_MS = 2000; // matches the CSS draw-in: 6 columns x --stagger + --dur-draw

const IDLE = `<div><span class="t-caption">The connected record</span><h3 class="tx-code">Every step has a source.</h3></div>
  <div><p>Select a source to see where its biochar went. Select a field to trace back to the production runs behind it.</p></div>
  <div><p class="t-caption">Example data from an illustrative operation.</p></div>`;

function detailHtml(graph, id) {
  const n = graph.byId.get(id);
  const up = [...walk(graph, id, "up")].filter((k) => graph.byId.get(k).st === "sup").length;
  const down = [...walk(graph, id, "down")].filter((k) => graph.byId.get(k).st === "app").length;
  const reach = [up && `${up} ${up === 1 ? "source" : "sources"} upstream`, down && `${down} ${down === 1 ? "application" : "applications"} downstream`].filter(Boolean).join(", ");
  return `<div><span class="t-caption">${esc(STAGES[n.st].label)}</span><h3 class="tx-code">${esc(n.code)}</h3><p>${esc(n.quantity)}</p></div>
    <div><span class="t-caption">The connection</span><p>${esc(n.note)}</p><p class="t-caption">${esc(reach || "Source of the selected chain")}</p></div>
    <div><span class="t-caption">Supporting evidence</span><p><strong>${esc(n.evidence)}</strong></p><p class="t-caption">Illustrative record</p></div>`;
}

export function mountTrace(root) {
  const svg = root.querySelector("svg");
  const select = root.querySelector("[data-trace-select]");
  const detail = root.querySelector("[data-record-detail]");
  let scale = "simple", graph = null, pinned = DEFAULT_RECORD;

  function lightPath(id) {
    if (!id || reducedMotion()) return;
    const at = graph.byId.get(id).col;
    graph.edgeEls.forEach((p) => p.classList.remove("tx-lit", "tx-up"));
    void svg.getBoundingClientRect(); // restart the animation on re-pin
    graph.edgeEls.forEach((p) => {
      if (!p.classList.contains("on")) return;
      const a = graph.byId.get(p._a).col, b = graph.byId.get(p._b).col, up = b <= at;
      p.style.setProperty("--d", up ? at - b : a - at);
      p.classList.toggle("tx-up", up);
      p.classList.add("tx-lit");
    });
  }
  function show(id, animate = false) {
    highlight(svg, graph, id);
    detail.innerHTML = id ? detailHtml(graph, id) : IDLE;
    select.value = id || "";
    if (animate) lightPath(id);
  }
  const pin = (id) => { pinned = id || null; show(pinned, true); };

  function render() {
    graph = GRAPHS[scale]();
    root.dataset.size = scale;
    drawGraph(svg, graph, { size: scale === "simple" ? LAYOUT.smallSize : LAYOUT.largeSize, glyphs: true, labels: scale === "simple", focusable: scale === "simple" });
    graph.edgeEls.forEach((p) => { p.setAttribute("pathLength", "1"); p.style.setProperty("--c", graph.byId.get(p._a).col); });
    select.innerHTML = '<option value="">All connections</option>' + graph.nodes.map((n) => `<option value="${esc(n.id)}">${esc(n.code)}</option>`).join("");
    if (pinned && !graph.byId.has(pinned)) pinned = DEFAULT_RECORD;
  }

  const idOf = (t) => t?.closest?.("[data-id]")?.dataset.id || null;
  svg.addEventListener("pointerover", (e) => { const id = idOf(e.target); if (id) show(id); });
  svg.addEventListener("pointerout", (e) => { if (idOf(e.target) && !idOf(e.relatedTarget)) show(pinned); });
  svg.addEventListener("click", (e) => { const id = idOf(e.target); pin(id && id !== pinned ? id : null); });
  svg.addEventListener("focusin", (e) => { const id = idOf(e.target); if (id && e.target.matches(":focus-visible") && id !== pinned) pin(id); });
  svg.addEventListener("keydown", (e) => {
    const id = idOf(e.target);
    if (!id) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pin(id); }
    if (e.key === "Escape") pin(null);
    const adjacency = e.key === "ArrowLeft" ? graph.inn : e.key === "ArrowRight" ? graph.out : null;
    const next = adjacency?.get(id)?.[0];
    if (next) { e.preventDefault(); graph.nodeEls.get(next).focus(); pin(next); }
  });
  select.addEventListener("change", () => pin(select.value));
  root.querySelector("[data-clear-trace]").addEventListener("click", () => pin(null));
  root.querySelectorAll("[data-scale]").forEach((button) => button.addEventListener("click", () => {
    scale = button.dataset.scale;
    root.querySelectorAll("[data-scale]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    render();
    show(pinned, true);
  }));

  render();
  if (reducedMotion() || !("IntersectionObserver" in window)) { show(pinned); return; }
  // First view: every edge draws in by column, then the default record lights its path.
  detail.innerHTML = detailHtml(graph, pinned);
  select.value = pinned;
  svg.classList.add("tx-armed");
  onFirstView(svg, () => {
    requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.add("tx-play")));
    setTimeout(() => { svg.classList.remove("tx-armed", "tx-play"); show(pinned, true); }, DRAW_MS);
  }, { threshold: 0.4 });
}
