/**
 * The dashboard's traceability scene. Mafinga, Southern Highlands: one
 * continuous view read left to right as the material's journey, in three
 * depths. At the back, plantation ridges fading into haze
 * (scene-landscape-backdrop.tsx); in the middle, the six stations on one
 * ground line (scene-landscape-stations.tsx); in front, the ground strip,
 * split into the six hover lots.
 *
 * The material moves by real things only: a feed belt from the intake hopper
 * up into the reactor, and a discharge auger from the plant roof over to the
 * filling frame's spout. Trucks carry it on the ground line between the rest.
 *
 * Contract with the stage band (stage-band.tsx):
 * - One <svg> filling its box, viewBox `0 ${CROP.y0} ${SCENE_W} ${CROP.height}`,
 *   `aria-hidden`. SCENE_W is SCENE_GEOMETRY.width, so the column grid lines up.
 * - Six bays centred at BAY_CENTERS; the column edges are COLUMN_EDGES. Each
 *   station's drawing stays inside its own column; only the connectors that
 *   carry material (belt, auger) cross a column edge.
 * - Hover hooks (stage-scene.css): each station is a <g data-art-stage={key}>
 *   and each column's ground piece is a <path className="scene-lot"
 *   data-art-lot={key}> drawn under the stations.
 */
"use client";

import { Backdrop } from "./scene-landscape-backdrop";
import { COLUMN_EDGES, Dots, GROUND_Y, INK, DETAIL_STROKE, type Point, pt, r2, SCENE_W, STAGES, STRIP_BOTTOM, STROKE } from "./scene-landscape-kit";
import {
  Applications,
  Deliveries,
  Feedstock,
  HOPPER_OUTLET,
  PLANT_OUTLET,
  Production,
  Products,
  REACTOR_INLET,
  SPOUT_TOP,
  Suppliers,
} from "./scene-landscape-stations";

/* ---------------------------------------------------------------- frame */

const CROP_TOP = 0;
export const CROP = { y0: CROP_TOP, height: STRIP_BOTTOM - CROP_TOP };

const LOT_BOUNDS = [0, ...COLUMN_EDGES, SCENE_W] as const;
const LOT_PATHS = STAGES.map(
  (_, index) => `M${LOT_BOUNDS[index]} ${GROUND_Y} H${LOT_BOUNDS[index + 1]} V${STRIP_BOTTOM} H${LOT_BOUNDS[index]} Z`,
);
const GROUND_LINE = `M0 ${GROUND_Y} H${SCENE_W}`;
const EDGE_LINES = COLUMN_EDGES.map((x) => `M${x} ${GROUND_Y} V${STRIP_BOTTOM}`).join(" ");

/* ----------------------------------------------------------- connectors */

const axes = (from: Point, to: Point) => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  return { along: [dx / length, dy / length] as Point, up: [dy / length, -dx / length] as Point };
};
const at = (p: Point, v: Point, k: number): Point => [p[0] + v[0] * k, p[1] + v[1] * k];
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function stadium(from: Point, to: Point, half: number) {
  const { up } = axes(from, to);
  return `M${pt(at(from, up, half))} L${pt(at(to, up, half))} A${half} ${half} 0 0 1 ${pt(at(to, up, -half))} L${pt(at(from, up, -half))} A${half} ${half} 0 0 1 ${pt(at(from, up, half))} Z`;
}

/** The feed belt: under the hopper's throat, up to the reactor's inlet, on two trestles. */
const BELT_HALF = 2.4;
const BELT_FROM: Point = HOPPER_OUTLET;
const BELT_TO: Point = REACTOR_INLET;
const BELT = stadium(BELT_FROM, BELT_TO, BELT_HALF);
const BELT_TRESTLES = [0.38, 0.72]
  .map((t) => {
    const [x, y] = lerp(BELT_FROM, BELT_TO, t);
    return `M${r2(x)} ${r2(y + BELT_HALF)} L${r2(x - 4)} ${GROUND_Y} M${r2(x)} ${r2(y + BELT_HALF)} L${r2(x + 4)} ${GROUND_Y}`;
  })
  .join(" ");
const BELT_GRAINS = [0.22, 0.42, 0.62, 0.82].map((t) => at(lerp(BELT_FROM, BELT_TO, t), axes(BELT_FROM, BELT_TO).up, BELT_HALF + 2));

/** The discharge auger: off the plant roof, over the yard, into the top of the spout. */
const AUGER_HALF = 2.8;
const AUGER = stadium(PLANT_OUTLET, SPOUT_TOP, AUGER_HALF);
const AUGER_FLIGHT_SLANT = 1.6;
const AUGER_FLIGHTS = [0.2, 0.35, 0.5, 0.65, 0.8]
  .map((t) => {
    const { along, up } = axes(PLANT_OUTLET, SPOUT_TOP);
    const mid = lerp(PLANT_OUTLET, SPOUT_TOP, t);
    return `M${pt(at(at(mid, up, -AUGER_HALF), along, -AUGER_FLIGHT_SLANT))} L${pt(at(at(mid, up, AUGER_HALF), along, AUGER_FLIGHT_SLANT))}`;
  })
  .join(" ");
const AUGER_MAST_T = 0.55;
const AUGER_MAST = (() => {
  const [x, y] = lerp(PLANT_OUTLET, SPOUT_TOP, AUGER_MAST_T);
  return `M${r2(x)} ${r2(y + AUGER_HALF)} V${GROUND_Y}`;
})();

/* ---------------------------------------------------------------- motion */

/**
 * Strokes hold their on-screen weight at every page width. Two loops: the
 * flue's smoke drifts up and thins, and a grain drops from the spout into
 * the bag.
 */
const SCENE_STYLE = `.scene-art :is(path, circle, rect, ellipse) { vector-effect: non-scaling-stroke; }
@media (prefers-reduced-motion: no-preference) {
  .scene-smoke { animation: scene-rise 6s ease-in-out infinite; }
  @keyframes scene-rise {
    0%, 100% { transform: translate(0, 0); opacity: 0.55; }
    50% { transform: translate(1.5px, -2.5px); opacity: 0.25; }
  }
  .scene-fall { animation: scene-fall 1.6s ease-in infinite; }
  @keyframes scene-fall {
    0% { transform: translateY(-2px); opacity: 0; }
    30% { opacity: 1; }
    100% { transform: translateY(4px); opacity: 0; }
  }
}`;

export function Scene() {
  return (
    <svg
      viewBox={`0 ${CROP.y0} ${SCENE_W} ${CROP.height}`}
      className="scene-art block h-auto w-full"
      aria-hidden
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <style>{SCENE_STYLE}</style>

      <Backdrop />

      {/* The ground strip (empty), the hover lots, the column edges, the ground line. */}
      <rect x={0} y={GROUND_Y} width={SCENE_W} height={STRIP_BOTTOM - GROUND_Y} fill={INK.strip} stroke="none" />
      {LOT_PATHS.map((d, index) => (
        <path key={STAGES[index]} d={d} className="scene-lot" data-art-lot={STAGES[index]} stroke="none" />
      ))}
      <path d={EDGE_LINES} stroke={INK.edge} strokeWidth={DETAIL_STROKE} />
      <path d={GROUND_LINE} stroke={INK.line} strokeWidth={DETAIL_STROKE} />

      {/* Connectors: they carry material across the column edges. */}
      <g style={{ color: INK.line }}>
        <path d={BELT_TRESTLES} strokeWidth={DETAIL_STROKE} />
        <path d={BELT} fill={INK.knockout} />
        <path d={AUGER_MAST} strokeWidth={DETAIL_STROKE} />
        <path d={AUGER} fill={INK.knockout} />
        <path d={AUGER_FLIGHTS} strokeWidth={DETAIL_STROKE} />
      </g>
      <g style={{ color: INK.prod }}>
        <Dots points={BELT_GRAINS} />
      </g>

      <Suppliers />
      <Feedstock />
      <Production />
      <Products />
      <Deliveries />
      <Applications />
    </svg>
  );
}
