// Home hero map: a small port of the app's Carbon Viewer map
// (src/components/chain-of-custody/map/carbon-transit-map.tsx, src/components/map/map-theme.ts).
// MapTiler "dataviz" basemap recoloured into a diagram (labels hidden, hairline boundaries), square
// site markers, bowed legs with marching ants, distance chips and record cards.
// Without PUBLIC_MAPTILER_KEY the map runs on a blank style over the dotted field (hero-map.css).
import { SITES, LEGS, RECORDS, legKm } from "./data.js";
import { recordCard as sharedCard } from "../../record-card.js";

const KEY = import.meta.env.PUBLIC_MAPTILER_KEY;
const STYLE_URL = KEY ? `https://api.maptiler.com/maps/dataviz/style.json?key=${encodeURIComponent(KEY)}` : null;
const START = { center: [35.29, -8.32], zoom: 9.4 };

const ARC_SEGMENTS = 32;
const ARC_BOW_FACTOR = 0.22; // bow as a fraction of the leg's length (app value)
const ARC_MAX_BOW = 0.045; // degrees (app value)
const ANTS = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
const ANTS_MS = 90;
const LEG_WIDTH = 1.8;
const LEG_OPACITY = 0.6;
const ANTS_WIDTH = 1.5;
const ANTS_OPACITY = 0.8;
const DIM_OPACITY = 0.1;
const CARD_WIDTH = "280px";
const CARD_OFFSET = 18;
const FLY_MS = 1600;
const FIT_MAX_ZOOM = 11.5;
const WATER = /water|ocean|river|lake|waterway/i;
const BOUNDARY = /boundary|admin/i;

/** Canvas paint cannot read CSS variables, so resolve the tokens once at mount. */
function palette() {
  const css = getComputedStyle(document.documentElement);
  const t = (name) => css.getPropertyValue(name).trim();
  return { sea: t("--hero-map-sea"), land: t("--hero-map-land"), boundary: t("--hero-map-boundary"), detail: t("--hero-map-detail"),
    inbound: t("--prod"), outbound: t("--dist"), ink: t("--ink") };
}

/** Recolour every base-style layer in place (the app's applyBrandRecolor). */
function recolor(map, p) {
  for (const { id, type } of map.getStyle()?.layers ?? []) {
    if (id.startsWith("noma-")) continue;
    try {
      if (type === "symbol") map.setLayoutProperty(id, "visibility", "none");
      else if (type === "background") map.setPaintProperty(id, "background-color", p.sea);
      else if (type === "fill") {
        const c = WATER.test(id) ? p.sea : p.land;
        map.setPaintProperty(id, "fill-color", c);
        map.setPaintProperty(id, "fill-outline-color", c);
      } else if (type === "line") {
        if (WATER.test(id)) map.setLayoutProperty(id, "visibility", "none");
        else if (BOUNDARY.test(id)) { map.setPaintProperty(id, "line-color", p.boundary); map.setPaintProperty(id, "line-width", 1); }
        else map.setPaintProperty(id, "line-color", p.detail);
      } else map.setLayoutProperty(id, "visibility", "none");
    } catch { /* a layer that rejects a property keeps its style; recolouring is best effort */ }
  }
}

/** Bowed arc between two points (the app's unrouted leg shape). flip alternates the bow side. */
function arc([x1, y1], [x2, y2], flip) {
  const dx = x2 - x1; const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const bow = Math.min(len * ARC_BOW_FACTOR, ARC_MAX_BOW) * flip;
  const cx = (x1 + x2) / 2 - (dy / len) * bow;
  const cy = (y1 + y2) / 2 + (dx / len) * bow;
  return Array.from({ length: ARC_SEGMENTS + 1 }, (_, i) => {
    const t = i / ARC_SEGMENTS;
    return [(1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2];
  });
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

const ACCENT = { supplier: "var(--prod)", facility: "var(--infra)", field: "var(--dist)" };

/** Record card: the shared record card (../../record-card.js) with type, code and label/value rows, and
 *  optionally a station drawing (a ContourArt node) on top, plotted in and looping while the card is open. */
export function recordCard({ kind, type, code, rows, art }) {
  const card = sharedCard({ label: type, code, holds: rows, art, float: true, accent: ACCENT[kind] });
  if (art) card.classList.add("is-active", "is-plotting");
  return card;
}

export function siteCard(id) {
  const site = SITES.find((s) => s.id === id);
  return recordCard({ kind: site.kind, type: RECORDS[id].type, code: site.code, rows: RECORDS[id].rows });
}

export const kindOf = (id) => SITES.find((s) => s.id === id)?.kind ?? "facility";

/**
 * Mount the map into `container`. Returns null when WebGL is unavailable (the container keeps its
 * dotted field). Call destroy() when done.
 * opts: padding (initial fit), card ({ anchor, offset } for the MapLibre popup), onSite(id, event).
 */
export async function createHeroMap(container, opts = {}) {
  const { default: maplibregl } = await import("maplibre-gl");
  await import("maplibre-gl/dist/maplibre-gl.css");
  const p = palette();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const byId = Object.fromEntries(SITES.map((s) => [s.id, s]));

  let map;
  try {
    map = new maplibregl.Map({
      container,
      style: STYLE_URL ?? { version: 8, sources: {}, layers: [] },
      ...START,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      scrollZoom: false, // the page scrolls; the map never takes the wheel
      touchZoomRotate: !coarse,
      dragPan: !coarse, // a finger on the map scrolls the page
      keyboard: false,
      fadeDuration: 0,
    });
  } catch {
    return null;
  }
  if (!KEY) container.classList.add("hm-map--blank");
  await new Promise((resolve) => map.once("load", resolve));
  if (KEY) recolor(map, p);

  const legFeatures = LEGS.map((leg, i) => {
    const a = byId[leg.from]; const b = byId[leg.to];
    return { type: "Feature", properties: { legId: leg.id, kind: leg.kind },
      geometry: { type: "LineString", coordinates: arc([a.lng, a.lat], [b.lng, b.lat], i % 2 ? -1 : 1) } };
  });
  map.addSource("noma-legs", { type: "geojson", data: { type: "FeatureCollection", features: legFeatures }, promoteId: "legId" });
  const dimmed = (on, off) => ["case", ["boolean", ["feature-state", "dim"], false], off, on];
  map.addLayer({ id: "noma-legs", type: "line", source: "noma-legs", layout: { "line-cap": "round" },
    paint: { "line-color": ["match", ["get", "kind"], "inbound", p.inbound, p.outbound], "line-width": LEG_WIDTH, "line-opacity": dimmed(LEG_OPACITY, DIM_OPACITY) } });
  map.addLayer({ id: "noma-ants", type: "line", source: "noma-legs",
    paint: { "line-color": p.ink, "line-width": ANTS_WIDTH, "line-opacity": dimmed(ANTS_OPACITY, 0), "line-dasharray": ANTS[0] } });

  // Marching ants: cycling the dasharray makes the gaps travel toward the field.
  let visible = true;
  let step = 0;
  const ants = reduced ? 0 : setInterval(() => {
    if (!visible) return;
    step = (step + 1) % ANTS.length;
    map.setPaintProperty("noma-ants", "line-dasharray", ANTS[step]);
  }, ANTS_MS);

  const chips = new Map();
  for (const f of legFeatures) {
    const pts = f.geometry.coordinates;
    const chip = el("div", "hm-chip", `${legKm(LEGS.find((l) => l.id === f.properties.legId))} km`);
    chips.set(f.properties.legId, new maplibregl.Marker({ element: chip }).setLngLat(pts[Math.floor(pts.length / 2)]).addTo(map));
  }

  const markers = new Map();
  for (const site of SITES) {
    const node = el("div", `hm-mk hm-mk--${site.kind}`);
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `${site.code}, ${site.sub}`);
    const label = el("span", "hm-lbl");
    label.append(el("span", "hm-lbl-code", site.code), el("span", "hm-lbl-sub", site.sub));
    node.append(el("span", "hm-ring"), el("span", "hm-shape"), label);
    for (const type of ["mouseenter", "mouseleave", "focus", "blur", "click"]) node.addEventListener(type, (e) => opts.onSite?.(site.id, e));
    markers.set(site.id, new maplibregl.Marker({ element: node }).setLngLat([site.lng, site.lat]).addTo(map));
  }

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "hm-pop", maxWidth: CARD_WIDTH,
    offset: opts.card?.offset ?? CARD_OFFSET, ...(opts.card?.anchor ? { anchor: opts.card.anchor } : {}) });

  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  io.observe(container);
  const ro = new ResizeObserver(() => map.resize());
  ro.observe(container);

  const fly = (camera) => (reduced ? map.jumpTo(camera) : map.flyTo({ duration: FLY_MS, essential: false, ...camera }));
  const handle = {
    /** Frame a set of sites; zoom caps single-site views. */
    frame(ids, { padding, zoom = FIT_MAX_ZOOM, pitch = 0, animate = true } = {}) {
      const bounds = new maplibregl.LngLatBounds();
      for (const id of ids) bounds.extend([byId[id].lng, byId[id].lat]);
      const cam = map.cameraForBounds(bounds, { padding, maxZoom: zoom });
      if (!cam) return;
      const camera = { ...cam, bearing: 0, pitch };
      if (animate) fly(camera); else map.jumpTo(camera);
    },
    /** Light a set of sites and legs; everything else dims. null clears. */
    highlight(sel) {
      for (const f of legFeatures) map.setFeatureState({ source: "noma-legs", id: f.properties.legId }, { dim: !!sel && !sel.legs.includes(f.properties.legId) });
      for (const [id, m] of markers) m.getElement().classList.toggle("hm-dim", !!sel && !sel.sites.includes(id));
      for (const [id, c] of chips) c.getElement().classList.toggle("hm-dim", !!sel && !sel.legs.includes(id));
    },
    openCard(id, content) {
      for (const [key, m] of markers) m.getElement().classList.toggle("hm-focus", key === id);
      popup.setLngLat([byId[id].lng, byId[id].lat]).setDOMContent(content ?? siteCard(id)).addTo(map);
    },
    destroy() {
      clearInterval(ants);
      io.disconnect();
      ro.disconnect();
      map.remove();
    },
  };
  handle.frame(SITES.map((s) => s.id), { padding: opts.padding, animate: false });
  return handle;
}
