// Journey page: camera maths. The chain lives on a flat km plane (x east, y south from a north-west
// origin) so fitting and flying are simple; toMap() converts a camera to MapLibre centre and zoom.
// The plane is a local approximation of Web Mercator, fine across the ~100 km this page covers.
import { clamp } from "./format.js";

const LNG0 = 34.75;
const LAT0 = -7.85;
const KM_X = 110.2; // km per degree of longitude at this latitude
const KM_Y = 110.6;
const EARTH_CIRC_KM = 40075.016686;
const TILE_PX = 512; // MapLibre tile size
const SMOOTH_RHO = 1.3; // van Wijk and Nuij: how much a long flight zooms out

export const P = (lat, lng) => ({ x: (lng - LNG0) * KM_X, y: (LAT0 - lat) * KM_Y });
export const fromP = (p) => ({ lng: LNG0 + p.x / KM_X, lat: LAT0 - p.y / KM_Y });

/** px per km on the plane to a MapLibre zoom level, and back. */
export function zoomFor(s, lat) {
  return Math.log2((s * EARTH_CIRC_KM * Math.cos((lat * Math.PI) / 180)) / TILE_PX);
}
export function scaleFor(zoom, lat) {
  return (TILE_PX * 2 ** zoom) / (EARTH_CIRC_KM * Math.cos((lat * Math.PI) / 180));
}
/** Camera { cx, cy, s } to what MapLibre takes. */
export function toMap(c) {
  const { lng, lat } = fromP({ x: c.cx, y: c.cy });
  return { center: [lng, lat], zoom: zoomFor(c.s, lat) };
}
export function fromMap(map) {
  const ctr = map.getCenter();
  const p = P(ctr.lat, ctr.lng);
  return { cx: p.x, cy: p.y, s: scaleFor(map.getZoom(), ctr.lat) };
}

/**
 * Fit a target to the visible area. T is { at, s } (a point at a scale) or { pts, pad, max }
 * (frame a set of points). I holds the screen insets the header and sheet cover. The returned
 * camera is shifted so the target sits in the middle of what stays visible.
 */
export function fit(T, I, VW, VH, graphScale) {
  const aw = Math.max(60, VW - I.l - I.r);
  const ah = Math.max(60, VH - I.t - I.b);
  let cx;
  let cy;
  let s;
  if (T.at) {
    s = T.s === "node" ? graphScale(aw) : T.s;
    cx = T.at.x;
    cy = T.at.y;
  } else {
    let x0 = 1e9;
    let x1 = -1e9;
    let y0 = 1e9;
    let y1 = -1e9;
    for (const p of T.pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const pad = T.pad || 2;
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    s = Math.min(aw / (x1 - x0), ah / (y1 - y0), T.max || 40);
    cx = (x0 + x1) / 2;
    cy = (y0 + y1) / 2;
  }
  return { cx: cx - (I.l - I.r) / 2 / s, cy: cy - (I.t - I.b) / 2 / s, s };
}

/** van Wijk and Nuij smooth zoom between two cameras: returns t in 0..1 to a camera. W is the view width in px. */
export function interpZoom(a, b, W) {
  const rho = SMOOTH_RHO;
  const r2 = rho * rho;
  const r4 = r2 * r2;
  const w0 = W / a.s;
  const w1 = W / b.s;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-10) {
    const S = Math.log(w1 / w0) / rho;
    return (t) => ({ cx: a.cx + t * dx, cy: a.cy + t * dy, s: W / (w0 * Math.exp(rho * t * S)) });
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + r4 * d2) / (2 * w0 * r2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - r4 * d2) / (2 * w1 * r2 * d1);
  const q0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const q1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (q1 - q0) / rho;
  const c0 = Math.cosh(q0);
  return (t) => {
    const s = t * S;
    const u = (w0 / (r2 * d1)) * (c0 * Math.tanh(rho * s + q0) - Math.sinh(q0));
    return { cx: a.cx + u * dx, cy: a.cy + u * dy, s: W / ((w0 * c0) / Math.cosh(rho * s + q0)) };
  };
}

export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Point at fraction u (0..1) of a [lng, lat] polyline by length, plus the cumulative lengths. */
export function lineMeasure(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * KM_X;
    const dy = (coords[i][1] - coords[i - 1][1]) * KM_Y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return cum;
}
export function lineAt(coords, cum, u) {
  const total = cum[cum.length - 1];
  const d = clamp(u, 0, 1) * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const k = (d - cum[i - 1]) / seg;
  return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * k, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * k];
}
