// Journey page map: MapTiler "dataviz-dark" recoloured to the noma dark stage (same approach as the
// home hero map, home/hero-map/map.js), with the transport legs drawn on their routed roads.
// Without PUBLIC_MAPTILER_KEY it runs on a blank style over a dotted field. Without WebGL
// createJourneyMap returns null and the page leaves the map view out.
import { HERO, J, LEGS, PLANT_LL, R, SUPS, TOWNS, apps, supShort, supTown } from "./model.js";
import { lineAt, lineMeasure } from "./geo.js";
import { createPlant } from "./plant.js";
import { RM } from "./state.js";

const KEY = import.meta.env.PUBLIC_MAPTILER_KEY;
const STYLE_URL = KEY ? `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${encodeURIComponent(KEY)}` : null;
const BLANK = { version: 8, sources: {}, layers: [] };
const START = { center: PLANT_LL, zoom: 9 };
const MIN_ZOOM = 5.5;
const MAX_ZOOM = 17.5;
const STYLE_TIMEOUT_MS = 8000;
const ARC_SEGMENTS = 32;
const ARC_BOW = 0.16; // an unrouted leg bows by this fraction of its length
const ANTS = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
const ANTS_MS = 90;
const TRUCK_MS = 2600;
const FEW_LIT = 6; // field labels show while this few fields are lit
const NEAR_PLANT_KM = 3; // fields this close get nudged off the plant marker
const NUDGE_PX = 13;
const DUP_PX = 9;
const WATER = /water|ocean|river|lake/i;
const BORDER = /border/i;
const ROAD = /^road network$/i;
const FOREST = /^forest$/i;
const WOOD = /^landcover$/i;
const URBAN = /residential/i;
const NO_FILL = /building|pier|bridge|aeroway|stadium|cemetery/i;
const HILL_EXAGGERATION = 0.35;
// SAT: the same Esri imagery as the app's map controls (src/config/geo.ts), dimmed so the light legs and labels still read
const SAT_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SAT_ATTRIBUTION = "Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const SAT_TILE_SIZE = 256;
const SAT_SATURATION = -0.4;
const SAT_BRIGHTNESS_MAX = 0.72;
const STATE = { rel: 1, trail: 2, cur: 3 };

/** Canvas paint cannot read CSS variables, so resolve the tokens once at mount. */
function palette(host) {
  const css = getComputedStyle(host);
  const t = (n) => css.getPropertyValue(n).trim();
  return { land: t("--jr-map-land"), forest: t("--jr-map-forest"), wood: t("--jr-map-wood"), urban: t("--jr-map-urban"), water: t("--jr-map-water"), boundary: t("--jr-map-boundary"),
    roadMajor: t("--jr-map-road-major"), roadMid: t("--jr-map-road-mid"), roadMinor: t("--jr-map-road-minor"),
    hillShadow: t("--jr-map-hill-shadow"), hillLight: t("--jr-map-hill-light"), hillAccent: t("--jr-map-hill-accent"),
    base: t("--jr-leg"), rel: t("--jr-leg-rel"), trail: t("--jr-leg-trail"), lit: t("--jr-lit"), glow: t("--jr-lit-glow") };
}

/** Recolour every base-style layer in place (the app's applyBrandRecolor, here for a dark stage). */
function recolor(map, p) {
  for (const { id, type } of map.getStyle()?.layers ?? []) {
    if (id.startsWith("noma-")) continue;
    try {
      if (type === "background") map.setPaintProperty(id, "background-color", p.land);
      else if (type === "fill") {
        if (NO_FILL.test(id) || /shadow/i.test(id)) { map.setLayoutProperty(id, "visibility", "none"); continue; }
        const c = WATER.test(id) ? p.water : FOREST.test(id) ? p.forest : WOOD.test(id) ? p.wood : URBAN.test(id) ? p.urban : p.land;
        map.setPaintProperty(id, "fill-color", c);
        map.setPaintProperty(id, "fill-opacity", 1);
        map.setPaintProperty(id, "fill-outline-color", c);
      } else if (type === "line") {
        if (WATER.test(id)) { map.setPaintProperty(id, "line-color", p.water); }
        else if (BORDER.test(id)) { map.setPaintProperty(id, "line-color", p.boundary); map.setPaintProperty(id, "line-width", 1); }
        else if (ROAD.test(id)) {
          // the road hierarchy: majors clearly, tracks and service roads barely
          map.setPaintProperty(id, "line-color", ["match", ["get", "class"], ["motorway", "trunk", "primary"], p.roadMajor, "secondary", p.roadMid, "tertiary", p.roadMid, p.roadMinor]);
          map.setPaintProperty(id, "line-opacity", 1);
          const w = (major, mid, minor) => ["match", ["get", "class"], ["motorway", "trunk", "primary"], major, ["secondary", "tertiary"], mid, minor];
          map.setPaintProperty(id, "line-width", ["interpolate", ["linear"], ["zoom"], 6, w(1.1, 0.7, 0.4), 12, w(2.4, 1.6, 0.9), 16, w(5, 3.5, 2)]);
        }
        else map.setLayoutProperty(id, "visibility", "none");
      } else map.setLayoutProperty(id, "visibility", "none");
    } catch { /* a layer that rejects a property keeps its style; recolouring is best effort */ }
  }
}

/** Terrain relief under the roads: MapTiler terrain-rgb as a hillshade in plum and ink. Skipped if it fails to load. */
function addRelief(map, p) {
  if (!KEY) return;
  try {
    map.addSource("noma-dem", { type: "raster-dem", url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${encodeURIComponent(KEY)}`, tileSize: 256 });
    const firstLine = map.getStyle().layers.find((l) => l.type === "line" && !l.id.startsWith("noma-"));
    map.addLayer({ id: "noma-hillshade", type: "hillshade", source: "noma-dem",
      paint: { "hillshade-exaggeration": HILL_EXAGGERATION, "hillshade-shadow-color": p.hillShadow, "hillshade-highlight-color": p.hillLight, "hillshade-accent-color": p.hillAccent, "hillshade-illumination-direction": 315 } }, firstLine?.id);
    map.on("error", (e) => { if (e.sourceId === "noma-dem" && map.getLayer("noma-hillshade")) map.removeLayer("noma-hillshade"); });
  } catch { /* no relief; the basemap still works */ }
}

/** Satellite imagery over the basemap, under the legs; hidden until the SAT button turns it on. Needs no key. */
function addSatellite(map) {
  try {
    map.addSource("noma-sat", { type: "raster", tiles: [SAT_TILES], tileSize: SAT_TILE_SIZE, attribution: SAT_ATTRIBUTION });
    map.addLayer({ id: "noma-sat", type: "raster", source: "noma-sat", layout: { visibility: "none" },
      paint: { "raster-saturation": SAT_SATURATION, "raster-brightness-max": SAT_BRIGHTNESS_MAX } });
    return true;
  } catch { return false; }
}

/** Bowed arc between two [lng, lat] points, for a leg without a routed line. */
function arc([x1, y1], [x2, y2], flip) {
  const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
  const bow = len * ARC_BOW * flip;
  const cx = (x1 + x2) / 2 - (dy / len) * bow; const cy = (y1 + y2) / 2 + (dx / len) * bow;
  return Array.from({ length: ARC_SEGMENTS + 1 }, (_, i) => {
    const t = i / ARC_SEGMENTS;
    return [(1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2];
  });
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Mount the map in `host`. hooks: onPick(recordId), onUser() when the visitor moves the map,
 * onMove() after every camera change. Resolves to a handle, or null without WebGL.
 */
export async function createJourneyMap(host, hooks) {
  let maplibregl;
  try {
    ({ default: maplibregl } = await import("maplibre-gl"));
    await import("maplibre-gl/dist/maplibre-gl.css");
  } catch { return null; }
  const p = palette(host);
  let map;
  try {
    map = new maplibregl.Map({
      container: host, style: STYLE_URL ?? BLANK, ...START, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
      attributionControl: false,
      dragRotate: false, pitchWithRotate: false, maxPitch: 0, keyboard: false, fadeDuration: 0,
    });
  } catch { return null; }
  // bottom left, so it can ride above the sheet (journey-map.css)
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Routes: OpenRouteService" }), "bottom-left");
  map.touchZoomRotate.disableRotation();
  map.getCanvas().tabIndex = -1;
  if (!KEY) host.classList.add("jr-map--blank");
  await new Promise((resolve) => {
    const loaded = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => {
      map.off("load", loaded);
      host.classList.add("jr-map--blank");
      map.once("style.load", resolve);
      map.setStyle(BLANK);
    }, STYLE_TIMEOUT_MS);
    map.once("load", loaded);
  });
  if (map.getStyle()?.layers?.length) { recolor(map, p); addRelief(map, p); }
  const hasSat = addSatellite(map);

  /* ----- legs: routed lines, state through feature-state, the lit one on its own source ----- */
  const features = LEGS.map((l, i) => {
    const coords = l.coords ?? arc(l.from, l.to, i % 2 ? -1 : 1);
    l.line = coords; l.cum = lineMeasure(coords);
    return { type: "Feature", properties: { id: l.key }, geometry: { type: "LineString", coordinates: coords } };
  });
  map.addSource("noma-legs", { type: "geojson", data: { type: "FeatureCollection", features }, promoteId: "id" });
  map.addSource("noma-lit", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const st = ["coalesce", ["feature-state", "st"], 0];
  const by = (a, b, c, d) => ["match", st, 3, d, 2, c, 1, b, a];
  map.addLayer({ id: "noma-leg", type: "line", source: "noma-legs", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": by(p.base, p.rel, p.trail, p.lit), "line-width": by(1.4, 1.7, 2, 2.4), "line-opacity": by(1, 1, 1, 0), "line-dasharray": [2.6, 2.6] } });
  map.addLayer({ id: "noma-leg-hit", type: "line", source: "noma-legs", paint: { "line-color": p.lit, "line-width": 20, "line-opacity": 0.01 } });
  map.addLayer({ id: "noma-lit-glow", type: "line", source: "noma-lit", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.glow, "line-width": 7, "line-blur": 5 } });
  map.addLayer({ id: "noma-lit", type: "line", source: "noma-lit", layout: { "line-join": "round" }, paint: { "line-color": p.lit, "line-width": 2.4, "line-dasharray": ANTS[0] } });
  let antStep = 0;
  const ants = RM() ? 0 : setInterval(() => {
    if (document.hidden || !litLegs.length) return;
    antStep = (antStep + 1) % ANTS.length;
    map.setPaintProperty("noma-lit", "line-dasharray", ANTS[antStep]);
  }, ANTS_MS);

  /* ----- markers ----- */
  const reg = new Map(); // lit key -> elements that take cur / trail / rel classes
  const mark = (key, node) => { if (!reg.has(key)) reg.set(key, []); reg.get(key).push(node); return node; };
  const marker = (node, ll, opts = {}) => new maplibregl.Marker({ element: node, ...opts }).setLngLat(ll).addTo(map);
  const pick = (node, id) => {
    node.tabIndex = 0; node.setAttribute("role", "button");
    node.addEventListener("click", (e) => { e.stopPropagation(); hooks.onPick(id); });
    node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hooks.onPick(id); } });
  };
  const plantXY = (ll) => Math.hypot((ll[0] - PLANT_LL[0]) * 110.2, (ll[1] - PLANT_LL[1]) * 110.6);

  TOWNS.forEach((t) => marker(el("div", "jr-town mono", t.name), [t.lng, t.lat]));

  const seen = {};
  apps.forEach((a) => {
    const node = el("div", "jr-fd");
    node.append(el("i", "jr-halo"), el("i", "jr-dot"), el("span", "jr-lab mono", R[a.code].fid));
    node.setAttribute("aria-label", `Field ${R[a.code].fid}`);
    pick(node, a.code);
    mark(`f:${a.code}`, node);
    const k = `${a.lat},${a.lng}`;
    const n = (seen[k] = (seen[k] ?? -1) + 1);
    let off = [0, 0];
    if (n) { const ang = -Math.PI / 2 + n * 2.1; off = [Math.cos(ang) * DUP_PX, Math.sin(ang) * DUP_PX]; }
    else if (plantXY([a.lng, a.lat]) < NEAR_PLANT_KM) off = [0, -NUDGE_PX];
    marker(node, [a.lng, a.lat], { offset: off });
  });

  const sups = [];
  SUPS.forEach((c, i) => {
    const s = J.suppliers.find((x) => x.code === c);
    const node = el("div", `jr-sp${i ? " up" : ""}`);
    const lab = el("span", "jr-lab");
    lab.append(el("b", "mono", supShort(s).toUpperCase()), el("small", "mono", [supTown(s).toUpperCase(), `${s.distanceToPlantKm} KM`].filter(Boolean).join(", ")));
    node.append(el("i", "jr-dot"), lab);
    node.setAttribute("aria-label", supShort(s));
    pick(node, c);
    mark(`s:${c}`, node);
    marker(node, [s.location.lng, s.location.lat]);
    sups.push({ node, lab, ll: [s.location.lng, s.location.lat] });
  });
  // a supplier's label goes to the right of its dot unless that runs off the screen
  const placeLabels = () => {
    for (const q of sups) {
      q.w ??= q.lab.getBoundingClientRect().width || 120;
      q.node.classList.toggle("left", map.project(q.ll).x + 14 + q.w > host.clientWidth - 8);
    }
  };

  const plantNode = el("div", "jr-plantmark");
  plantNode.append(el("i", "jr-sq"), (() => { const l = el("span", "jr-lab"); l.append(el("b", "mono", "PLANT, MAFINGA")); return l; })());
  plantNode.setAttribute("aria-label", "Plant, Mafinga");
  pick(plantNode, HERO.run);
  marker(plantNode, PLANT_LL);

  const chips = LEGS.map((l) => {
    const node = el("div", "jr-chip mono", `${l.km} km`);
    return { l, m: marker(node, lineAt(l.line, l.cum, 0.5)), node };
  });
  const truck = marker(el("i", "jr-truck"), PLANT_LL);
  truck.getElement().style.display = "none";

  const plant = createPlant(host, { onPick: hooks.onPick, codes: { fbin: HERO.feedBin, run: HERO.run, bbin: HERO.bin, prod: HERO.prod, smp: HERO.sample } });
  const PLANT_LABEL_W = 135; // px a plant label needs to its left
  const placePlant = () => { const q = map.project(PLANT_LL); plant.place(q.x, q.y); plantNode.classList.toggle("flip", q.x < PLANT_LABEL_W); };
  plant.layout(host.clientWidth);

  /* ----- events ----- */
  let litLegs = [];
  map.on("movestart", (e) => { if (e.originalEvent || e.user) hooks.onUser(); });
  map.on("move", () => { placePlant(); placeLabels(); hooks.onMove(); });
  map.on("render", () => { host.dataset.idle = map.loaded() ? "1" : "0"; });
  map.on("click", (e) => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ["noma-leg-hit"] })[0];
    if (!hit) return;
    const key = hit.properties.id; const code = key.slice(2);
    hooks.onPick(code);
  });
  map.on("mousemove", (e) => { map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: ["noma-leg-hit"] }).length ? "pointer" : ""; });
  const ro = new ResizeObserver(() => { map.resize(); plant.layout(host.clientWidth); placePlant(); });
  ro.observe(host);

  /* ----- the truck that drives the lit leg ----- */
  let raf = 0;
  const drive = (now) => {
    const l = litLegs[0];
    if (!l || RM()) { truck.getElement().style.display = "none"; raf = 0; return; }
    const u = (now / TRUCK_MS) % 1;
    const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    truck.setLngLat(lineAt(l.line, l.cum, e)).getElement().style.display = "";
    raf = requestAnimationFrame(drive);
  };

  const handle = {
    map,
    plant,
    setCamera(c) { map.jumpTo(c, { camera: true }); },
    zoomBy(dz) { map.easeTo({ zoom: map.getZoom() + dz, duration: RM() ? 0 : 280 }, { user: true }); },
    /** sets of lit keys: cur (selected), rel (related), trail (the path so far) */
    setLit({ cur, rel, trail, litCount }) {
      reg.forEach((nodes, key) => nodes.forEach((n) => {
        n.classList.toggle("cur", cur.has(key));
        n.classList.toggle("trail", !cur.has(key) && trail.has(key));
        n.classList.toggle("rel", !cur.has(key) && !trail.has(key) && rel.has(key));
      }));
      plantNode.classList.toggle("cur", [...cur].some((k) => k.startsWith("t:")));
      plantNode.classList.toggle("trail", [...trail].some((k) => k.startsWith("t:")));
      plant.setLit(cur, trail);
      host.classList.toggle("jr-few", litCount <= FEW_LIT);
      host.classList.toggle("jr-halo-on", litCount < 3);
      litLegs = LEGS.filter((l) => cur.has(l.key));
      for (const l of LEGS) {
        const s = cur.has(l.key) ? STATE.cur : trail.has(l.key) ? STATE.trail : rel.has(l.key) ? STATE.rel : 0;
        map.setFeatureState({ source: "noma-legs", id: l.key }, { st: s });
      }
      map.getSource("noma-lit").setData({ type: "FeatureCollection", features: litLegs.map((l) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: l.line } })) });
      chips.forEach((c) => c.node.classList.toggle("on", cur.has(c.l.key)));
      if (!litLegs.length) truck.getElement().style.display = "none";
      else if (!raf && !RM()) raf = requestAnimationFrame(drive);
    },
    /** 0..1: how much of the plant schematic shows; the plain plant marker takes the rest */
    setPlantWeight(w) { host.classList.toggle("jr-plant-on", w > 0.5); plant.setWeight(w); plantNode.style.opacity = (1 - w).toFixed(3); plantNode.classList.toggle("is-dim", w > 0.5); },
    hasSat,
    setSat(on) {
      if (!hasSat) return;
      map.setLayoutProperty("noma-sat", "visibility", on ? "visible" : "none");
      host.classList.toggle("jr-sat", on);
    },
    resize() { map.resize(); },
    ready() { host.classList.add("jr-map--ready"); },
    destroy() { clearInterval(ants); cancelAnimationFrame(raf); ro.disconnect(); map.remove(); },
  };
  return handle;
}
