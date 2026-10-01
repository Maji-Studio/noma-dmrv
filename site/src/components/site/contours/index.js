// Station line drawings (the SVGs in this folder, rendered by scripts/export-contours.mjs; don't hand-edit
// them). Server side, ContourArt.astro inlines one; in the browser, loadContour() fetches one on demand
// (each drawing is its own small chunk) and contourNode() turns it into the same markup. Either way
// scopeSvg() prefixes the drawing's ids, because the same drawing can appear more than once on a page.

/** One line per station, shared by every card that shows the station (TraceStage, the product trace). */
export const STATION_LINES = {
  source: "Where the wood residues came from.",
  "feedstock-delivery": "Weighed at the gate, before anything burns.",
  "production-run": "One reactor, one run, one mass balance.",
  "mix-bin": "Two runs share a bin, and every draw keeps their shares.",
  "biochar-product": "Bagged, and traceable to both runs.",
  delivery: "Half the product travels to one farm.",
  application: "Spread on a mapped field. The trace ends in the soil.",
};

export const scopeSvg = (raw, scope) => String(raw).replaceAll('id="', `id="${scope}-`).replaceAll('href="#', `href="#${scope}-`);

const LAZY = import.meta.glob("./*.svg", { query: "?raw", import: "default" });
const cache = new Map();

/** The raw SVG for a station, loaded once. Resolves to null for a station without a drawing. */
export function loadContour(station) {
  const load = LAZY[`./${station}.svg`];
  if (!load) return Promise.resolve(null);
  if (!cache.has(station)) cache.set(station, load());
  return cache.get(station);
}

/** A ContourArt node for the browser (same markup as ContourArt.astro) from a loaded drawing. */
export function contourNode(raw, scope) {
  const node = document.createElement("div");
  node.className = "contour-art";
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = scopeSvg(raw, scope); // our own build-time SVG, never user content
  return node;
}
