// Interactive trace: hover previews a record's path and opens its record card beside it; click or
// keyboard pins the path. With a pointer the card lives only while a record is hovered or keyboard focused;
// on narrow screens (no hover) it shows the pinned record under the graph. Edges draw in on first view; a pinned record lights its path outward from itself.
// The card is the shared record card (../record-card.js): the record's station drawing, a line and what it
// holds. The drawings load once the explorer first comes into view; a card opened before its drawing
// arrives is rebuilt when it does.
import { drawGraph, highlight, STAGES } from "../../../visuals/core.js";
import { onFirstView, reducedMotion } from "../motion.js";
import { recordCard } from "../record-card.js";
import { STATION_LINES, loadContour, contourNode } from "../contours/index.js";
import { LAYOUT, DEFAULT_RECORD, GRAPHS, STATION_OF } from "./trace-data.js";

const DRAW_MS = 2000; // matches the CSS draw-in: 6 columns x --stagger + --dur-draw
const CARD_GAP = 14; // px between a record's square and its card
const FLOATING = "(min-width: 801px)"; // below this the card sits under the graph (see trace.css)

const drawings = new Map(); // station -> raw SVG, filled as the drawings load

function cardFor(n) {
  const stage = STAGES[n.st], station = STATION_OF[n.st], raw = drawings.get(station);
  const card = recordCard({ label: stage.label, code: n.code, line: STATION_LINES[station] ?? n.note,
    holds: [...(n.holds ?? [n.quantity]), ["Evidence", n.evidence]], art: raw ? contourNode(raw, "tx") : null,
    float: true, accent: `var(--${stage.dom})` });
  card.classList.add("is-active", "is-plotting"); // plot the drawing in, then run its loops
  return card;
}

export function mountTrace(root) {
  const svg = root.querySelector("svg");
  const card = root.querySelector("[data-record-card]");
  const floating = matchMedia(FLOATING);
  let scale = "simple", graph = null, pinned = DEFAULT_RECORD, shown = null, hovered = null, focused = null;

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
  // Card beside the record, on whichever side has room, kept inside the explorer.
  function placeCard(n) {
    if (!floating.matches) { card.style.removeProperty("--x"); card.style.removeProperty("--y"); return; }
    const box = root.getBoundingClientRect(), g = svg.getBoundingClientRect(), k = g.width / LAYOUT.width;
    const half = ((scale === "simple" ? LAYOUT.smallSize : LAYOUT.largeSize) / 2) * k;
    const cx = g.left - box.left + n.x * k, cy = g.top - box.top + n.y * k;
    const w = card.offsetWidth, h = card.offsetHeight;
    const x = cx + half + CARD_GAP + w <= box.width ? cx + half + CARD_GAP : cx - half - CARD_GAP - w;
    const y = Math.min(Math.max(cy - h / 2, g.top - box.top), box.height - h);
    card.style.setProperty("--x", `${Math.round(x)}px`);
    card.style.setProperty("--y", `${Math.round(y)}px`);
  }
  function syncCard() {
    const id = hovered || focused || (floating.matches ? null : pinned);
    if (id !== shown) {
      shown = id;
      card.hidden = !id;
      if (id) {
        card.replaceChildren(cardFor(graph.byId.get(id)));
        placeCard(graph.byId.get(id));
        card.classList.remove("is-in");
        void card.offsetWidth; // replay the entrance for each record
        card.classList.add("is-in");
      }
    }
  }
  function show(id, animate = false) {
    highlight(svg, graph, id);
    syncCard();
    if (animate) lightPath(id);
  }
  const pin = (id) => { pinned = id || null; show(pinned, true); };

  function render() {
    graph = GRAPHS[scale]();
    root.dataset.size = scale;
    drawGraph(svg, graph, { size: scale === "simple" ? LAYOUT.smallSize : LAYOUT.largeSize, glyphs: true, labels: scale === "simple", focusable: scale === "simple" });
    graph.edgeEls.forEach((p) => { p.setAttribute("pathLength", "1"); p.style.setProperty("--c", graph.byId.get(p._a).col); });
    if (pinned && !graph.byId.has(pinned)) pinned = DEFAULT_RECORD;
    shown = undefined;
  }

  const idOf = (t) => t?.closest?.("[data-id]")?.dataset.id || null;
  svg.addEventListener("pointerover", (e) => { const id = idOf(e.target); if (id) { hovered = id; show(id); } });
  svg.addEventListener("pointerout", (e) => { if (idOf(e.target) && !idOf(e.relatedTarget)) { hovered = null; show(pinned); } });
  svg.addEventListener("click", (e) => { const id = idOf(e.target); pin(id && id !== pinned ? id : null); });
  svg.addEventListener("focusin", (e) => {
    const id = idOf(e.target);
    if (!id || !e.target.matches(":focus-visible")) return;
    focused = id;
    if (id !== pinned) pin(id); else syncCard();
  });
  svg.addEventListener("focusout", (e) => { if (!idOf(e.relatedTarget)) { focused = null; syncCard(); } });
  svg.addEventListener("keydown", (e) => {
    const id = idOf(e.target);
    if (!id) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pin(id); }
    if (e.key === "Escape") { focused = null; pin(null); }
    const adjacency = e.key === "ArrowLeft" ? graph.inn : e.key === "ArrowRight" ? graph.out : null;
    const next = adjacency?.get(id)?.[0];
    if (next) { e.preventDefault(); graph.nodeEls.get(next).focus(); pin(next); }
  });
  root.addEventListener("trace:pin", (e) => pin(e.detail));
  addEventListener("resize", () => { if (shown) placeCard(graph.byId.get(shown)); });
  floating.addEventListener("change", () => { shown = undefined; syncCard(); });
  root.querySelectorAll("[data-scale]").forEach((button) => button.addEventListener("click", () => {
    scale = button.dataset.scale;
    root.querySelectorAll("[data-scale]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    render();
    show(pinned, true);
  }));

  // Load the drawings when the explorer first shows; rebuild an open card whose drawing just arrived.
  onFirstView(root, () => {
    for (const station of new Set(Object.values(STATION_OF))) {
      loadContour(station).then((raw) => {
        drawings.set(station, raw);
        if (shown && STATION_OF[graph.byId.get(shown)?.st] === station) { shown = undefined; syncCard(); }
      });
    }
  }, { threshold: 0 });

  render();
  if (reducedMotion() || !("IntersectionObserver" in window)) { show(pinned); return; }
  // First view: every edge draws in by column, then the default record lights its path.
  svg.classList.add("tx-armed");
  onFirstView(svg, () => {
    requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.add("tx-play")));
    setTimeout(() => { svg.classList.remove("tx-armed", "tx-play"); show(pinned, true); }, DRAW_MS);
  }, { threshold: 0.4 });
}
