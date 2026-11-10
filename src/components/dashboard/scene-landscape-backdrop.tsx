/**
 * The back of the dashboard scene. Two rolling ridges of the Southern
 * Highlands fading into haze, pine plantation compartments on their slopes,
 * the sun, two clouds and two birds. Neutral ink only, so it stays far behind
 * the stations.
 */
"use client";

import { GROUND_Y, INK, DETAIL_STROKE, type Point, pt, r2, SCENE_W } from "./scene-landscape-kit";

/* -------------------------------------------------------------- ridges */

const SAMPLE_STEP = 8;
const OVERSCAN = 8;
interface Wave {
  amp: number;
  period: number;
  phase: number;
}
const ridgeY = (base: number, waves: readonly Wave[]) => (x: number) =>
  base + waves.reduce((sum, w) => sum + w.amp * Math.sin(x / w.period + w.phase), 0);

const FAR_Y = ridgeY(70, [
  { amp: 8, period: 105, phase: 0.6 },
  { amp: 3.5, period: 41, phase: 1.3 },
]);
const NEAR_Y = ridgeY(102, [
  { amp: 7, period: 150, phase: 2.4 },
  { amp: 3, period: 56, phase: 0.2 },
]);

const SAMPLES = Array.from({ length: Math.ceil((SCENE_W + OVERSCAN * 2) / SAMPLE_STEP) + 1 }, (_, i) => i * SAMPLE_STEP - OVERSCAN);
const ridgeLine = (y: (x: number) => number) => `M${SAMPLES.map((x) => pt([x, y(x)])).join(" L")}`;
const ridgeFill = (y: (x: number) => number) => `${ridgeLine(y)} V${GROUND_Y} H${-OVERSCAN} Z`;
const FAR_LINE = ridgeLine(FAR_Y);
const FAR_FILL = ridgeFill(FAR_Y);
const NEAR_LINE = ridgeLine(NEAR_Y);
const NEAR_FILL = ridgeFill(NEAR_Y);

/** Haze: each ridge fill fades from its crest to nothing at the ground. */
const HAZE_TOP = 56;
const HAZE_ID = { far: "scene-haze-far", near: "scene-haze-near" } as const;
const HAZE_STOPS = { far: 0.55, near: 0.7 } as const;

/* --------------------------------------------------------- plantations */

/** Compartments of planted pine on the slopes: [from x, to x, rows]. */
const FAR_BLOCKS = [
  [16, 128, 3],
  [318, 420, 2],
  [548, 640, 3],
  [880, 1000, 2],
] as const;
const NEAR_BLOCKS = [
  [150, 214, 2],
  [700, 790, 2],
  [1100, 1160, 2],
] as const;
const TREE_PITCH = 5.5;
const ROW_DROP = 4.6;
const TREE = { far: { h: 5.5, half: 1.8 }, near: { h: 7.5, half: 2.4 } } as const;

function plantation(blocks: readonly (readonly [number, number, number])[], y: (x: number) => number, size: { h: number; half: number }) {
  const trees: Point[] = [];
  for (const [from, to, rows] of blocks) {
    for (let row = 0; row < rows; row += 1) {
      const inset = (row % 2) * (TREE_PITCH / 2);
      for (let x = from + inset; x <= to; x += TREE_PITCH) trees.push([x, y(x) + size.h + 1 + row * ROW_DROP]);
    }
  }
  return trees.map(([x, base]) => `M${r2(x)} ${r2(base - size.h)} L${r2(x + size.half)} ${r2(base)} H${r2(x - size.half)} Z`).join(" ");
}
const FAR_PINES = plantation(FAR_BLOCKS, FAR_Y, TREE.far);
const NEAR_PINES = plantation(NEAR_BLOCKS, NEAR_Y, TREE.near);


/* ------------------------------------------------------------------ sky */

const SUN = { cx: 1062, cy: 30, r: 9 } as const;
/** Long, flat highland clouds: [left x, baseline y, length]. */
const CLOUDS = [
  [150, 26, 54],
  [632, 30, 70],
] as const;
function cloud(x: number, y: number, length: number) {
  const k = length / 60;
  const c = (dx: number, dy: number) => `${r2(x + dx * k)} ${r2(y + dy)}`;
  return `M${c(0, 0)} Q${c(2, -5)} ${c(10, -4)} Q${c(16, -11)} ${c(26, -8)} Q${c(34, -13)} ${c(42, -6)} Q${c(52, -7)} ${c(54, -2)} Q${c(60, -1)} ${c(60, 0)} Z`;
}
const CLOUD_PATHS = CLOUDS.map(([x, y, length]) => cloud(x, y, length)).join(" ");
/** Two birds over the deliveries road. */
const BIRDS = [
  [884, 44, 3.2],
  [897, 37, 2.6],
] as const;
const BIRD_PATHS = BIRDS.map(([x, y, w]) => `M${x - w} ${r2(y - w * 0.5)} Q${r2(x - w * 0.5)} ${r2(y - w * 0.8)} ${x} ${y} Q${r2(x + w * 0.5)} ${r2(y - w * 0.8)} ${x + w} ${r2(y - w * 0.5)}`).join(" ");
/** The whole back layer whispers: it draws at half strength behind the stations. */
const BACKDROP_OPACITY = 0.5;

export function Backdrop() {
  return (
    <g fill="none" strokeWidth={DETAIL_STROKE} opacity={BACKDROP_OPACITY}>
      <defs>
        {(["far", "near"] as const).map((key) => (
          <linearGradient key={key} id={HAZE_ID[key]} x1={0} y1={HAZE_TOP} x2={0} y2={GROUND_Y} gradientUnits="userSpaceOnUse">
            <stop offset={0} style={{ stopColor: INK.haze }} stopOpacity={HAZE_STOPS[key]} />
            <stop offset={1} style={{ stopColor: INK.haze }} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      <circle {...SUN} stroke={INK.far} />
      <path d={CLOUD_PATHS} stroke={INK.far} />
      <path d={BIRD_PATHS} stroke={INK.mid} />
      <path d={FAR_FILL} fill={`url(#${HAZE_ID.far})`} stroke="none" />
      <path d={FAR_PINES} fill={INK.haze} stroke="none" />
      <path d={FAR_LINE} stroke={INK.far} />
      <path d={NEAR_FILL} fill={`url(#${HAZE_ID.near})`} stroke="none" />
      <path d={NEAR_PINES} fill={INK.far} stroke="none" />
      <path d={NEAR_LINE} stroke={INK.mid} />
    </g>
  );
}
