// Journey page: shared state and helpers. The modules call each other through ctx at run time
// (each mount() adds its functions), so none of them imports another and there are no cycles.
export const $ = (id) => document.getElementById(id);
export const NS = "http://www.w3.org/2000/svg";
export const mk = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const RMQ = matchMedia("(prefers-reduced-motion: reduce)");
export const RM = () => RMQ.matches;
const DESK = matchMedia("(min-width: 960px)");
export const desk = () => DESK.matches;

export const st = {
  mode: "map", // "map" | "graph"
  snap: "mid", // sheet snap: low | mid | full
  levels: [], // chain, then nested branch carousels
  f: 0, // fractional card index, driven by the carousel scroll
  ai: -1, // active card index
  cam: { map: null, graph: null }, // camera now (map is the km-plane camera, see geo.js)
  free: { map: false, graph: false }, // the visitor moved the view; the cards no longer steer it
  blend: { map: null, graph: null }, // a flight from the old camera to the linked one
  cams: { map: null, graph: null }, // one fitted camera per card of the current level
  zi: { map: [], graph: [] }, // cached smooth-zoom interpolators between neighbouring cards
  VW: 0,
  VH: 0,
  booting: true,
};
export const lvl = () => st.levels[st.levels.length - 1];
export const ctx = {};
