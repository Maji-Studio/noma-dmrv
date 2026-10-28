// Journey page: the plant schematic, drawn over the map at the plant. It is an
// overlay in screen pixels, never in map units: the bins are not placed on the ground.
import { GL, KIND } from "./model.js";
import { mk } from "./state.js";

// [tile key, offset in pitches from the middle of the row, caption]
const TILES = [["fbin", -1.5, 0], ["run", -0.5, 0], ["bbin", 0.5, 0], ["prod", 1.5, 0], ["smp", 0.5, 1]];
const LINKS = [["fbin", "run"], ["run", "bbin"], ["bbin", "prod"], ["bbin", "smp"]];
const TILE = 30; // px, tile square
const MIN_PITCH = 62;
const MAX_PITCH = 96;
const SIDE = 44; // px, frame edge to the outer tile centre
const TOP = 34;
const BOTTOM = 40;
const LINK_GAP = TILE / 2 + 3;

/** codes: tile key to the record it opens. onPick(recordId). */
export function createPlant(host, { onPick, codes }) {
  const root = document.createElement("div");
  root.className = "jr-plant";
  root.innerHTML = '<p class="jr-plant-cap mono">Plant, Mafinga · schematic</p><svg class="jr-plant-svg" aria-hidden="true"></svg>';
  host.appendChild(root);
  const svg = root.querySelector("svg");
  const frame = mk("rect", { class: "jr-plant-frame" }, svg);
  const links = LINKS.map(([a, b]) => ({ a, b, el: mk("line", { class: "jr-conv" }, svg) }));
  const tiles = TILES.map(([k, dx, row]) => {
    const btn = document.createElement("button");
    btn.className = `jr-tile d-${KIND[k][1]}`;
    btn.type = "button";
    btn.setAttribute("aria-label", `${KIND[k][0]} ${codes[k]}`);
    btn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${GL[k]}"/></svg><span class="jr-tile-lab mono">${k === "run" ? "Reactor" : codes[k]}</span>`;
    btn.addEventListener("click", (e) => { e.stopPropagation(); onPick(codes[k]); });
    root.appendChild(btn);
    return { k, dx, row, btn, c: [0, 0] };
  });
  let size = { w: 0, h: 0 };
  let at = { x: 0, y: 0 };

  function layout(VW) {
    const pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, (VW - 2 * SIDE - 88) / 3));
    size = { w: pitch * 3 + 2 * SIDE, h: TOP + pitch * 1 + BOTTOM };
    root.style.width = `${size.w}px`;
    root.style.height = `${size.h}px`;
    svg.setAttribute("viewBox", `0 0 ${size.w} ${size.h}`);
    frame.setAttribute("x", 0.5); frame.setAttribute("y", 0.5);
    frame.setAttribute("width", size.w - 1); frame.setAttribute("height", size.h - 1);
    for (const t of tiles) {
      t.c = [size.w / 2 + t.dx * pitch, TOP + t.row * pitch * 0.9];
      t.btn.style.left = `${t.c[0] - TILE / 2}px`;
      t.btn.style.top = `${t.c[1] - TILE / 2}px`;
      t.btn.style.setProperty("--lab-w", `${pitch - 6}px`);
    }
    const by = Object.fromEntries(tiles.map((t) => [t.k, t.c]));
    for (const l of links) {
      const A = by[l.a]; const B = by[l.b];
      const dx = B[0] - A[0]; const dy = B[1] - A[1]; const len = Math.hypot(dx, dy) || 1;
      l.el.setAttribute("x1", A[0] + (dx / len) * LINK_GAP); l.el.setAttribute("y1", A[1] + (dy / len) * LINK_GAP);
      l.el.setAttribute("x2", B[0] - (dx / len) * LINK_GAP); l.el.setAttribute("y2", B[1] - (dy / len) * LINK_GAP);
    }
    place(at.x, at.y);
  }
  /** Put the schematic's middle on a screen point (the plant). */
  function place(x, y) {
    at = { x, y };
    root.style.transform = `translate(${(x - size.w / 2).toFixed(1)}px, ${(y - size.h / 2).toFixed(1)}px)`;
  }
  function setWeight(w) {
    root.style.opacity = w.toFixed(3);
    root.style.visibility = w < 0.02 ? "hidden" : "visible";
    root.classList.toggle("is-live", w > 0.6);
  }
  /** key sets use "t:<tile>" like the map's lit keys */
  function setLit(cur, trail) {
    for (const t of tiles) {
      t.btn.classList.toggle("cur", cur.has(`t:${t.k}`));
      t.btn.classList.toggle("trail", !cur.has(`t:${t.k}`) && trail.has(`t:${t.k}`));
    }
    for (const l of links) {
      const on = (k) => cur.has(`t:${k}`) || trail.has(`t:${k}`);
      l.el.classList.toggle("trail", on(l.a) && on(l.b));
    }
  }
  return { layout, place, setWeight, setLit };
}
