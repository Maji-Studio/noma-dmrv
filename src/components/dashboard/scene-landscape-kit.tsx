/**
 * The drawing kit for the dashboard scene (scene-landscape.tsx). The frame
 * (ground, scale, stroke, inks) and the glyphs drawn more than once or with
 * care: the knocked-out solid, grains, the wheel, the cab-over truck, the big
 * bag, the plantation pine, the maize plant, the tractor and its spreader.
 *
 * Scale: about 13 view-box units to the metre, so a truck cab stands 26
 * units and a 20 ft container is 86 long. Everything stands on GROUND_Y.
 */
"use client";

import type { ReactNode } from "react";

export type Point = readonly [number, number];
export type StageKey = "suppliers" | "feedstock" | "production" | "products" | "deliveries" | "applications";

/* ---------------------------------------------------------------- frame */

export const SCENE_W = 1160;
/** The ground line: every station, tree and person stands on it. */
export const GROUND_Y = 146;
/** Bottom of the ground strip and of the band. */
export const STRIP_BOTTOM = 166;
export const BAY_CENTERS = [120, 300, 480, 660, 840, 1020] as const;
export const COLUMN_EDGES = [210, 390, 570, 750, 930] as const;
/** The stage band's grid in scene units: six equal bays, the outer columns taking the side margins. */
export const SCENE_GEOMETRY = {
  width: SCENE_W,
  bayPitch: BAY_CENTERS[1] - BAY_CENTERS[0],
  leftInset: BAY_CENTERS[0] - (BAY_CENTERS[1] - BAY_CENTERS[0]) / 2,
  rightInset: SCENE_W - (BAY_CENTERS[5] + (BAY_CENTERS[1] - BAY_CENTERS[0]) / 2),
} as const;
export const STAGES: readonly StageKey[] = ["suppliers", "feedstock", "production", "products", "deliveries", "applications"];

/**
 * The only two stroke widths, in px on screen: every object outline draws at
 * STROKE; inner detail (ribs, bands, marks), the connectors, the ground and
 * the landscape lines draw at DETAIL_STROKE.
 */
export const STROKE = 1.25;
export const DETAIL_STROKE = 1;
/** Fill strengths for currentColor: fabric and wood, shade, char. */
export const TINT = { air: 0.05, light: 0.08, mid: 0.12, deep: 0.2, char: 0.42 } as const;
export const DOT_R = 1.4;

export const INK = {
  prod: "var(--acc-prod-ink)",
  infra: "var(--acc-infra-ink)",
  dist: "var(--acc-dist-ink)",
  line: "var(--clr-dark-purple-40)",
  mid: "var(--clr-dark-purple-30)",
  far: "var(--clr-dark-purple-20)",
  haze: "var(--clr-dark-purple-10)",
  edge: "var(--clr-purple-20)",
  strip: "var(--sea)",
  knockout: "var(--bg)",
} as const;

export const STAGE_INK: Record<StageKey, string> = {
  suppliers: INK.prod,
  feedstock: INK.prod,
  production: INK.infra,
  products: INK.prod,
  deliveries: INK.dist,
  applications: INK.dist,
};

const G = GROUND_Y;

/* -------------------------------------------------------------- helpers */

export const r2 = (value: number) => Math.round(value * 100) / 100;
export const pt = ([x, y]: Point) => `${r2(x)} ${r2(y)}`;

/** A closed shape that hides what is behind it, tinted with its ink, outlined. */
export function Solid({ d, tint = TINT.mid, className }: { d: string; tint?: number; className?: string }) {
  return (
    <>
      <path d={d} fill={INK.knockout} stroke="none" />
      <path d={d} fill="currentColor" fillOpacity={tint} className={className} />
    </>
  );
}

export function Dots({ points, r = DOT_R, className }: { points: readonly Point[]; r?: number; className?: string }) {
  return (
    <g className={className} fill="currentColor" stroke="none">
      {points.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
      ))}
    </g>
  );
}

/* ---------------------------------------------------------------- truck */

/** A cab-over truck facing right, its tail at x: a flat deck, a square cab with the driver, two wheels. */
export const TRUCK = { deck: 64, gap: 3, cab: 26, deckTop: G - 17, deckBottom: G - 12, cabTop: G - 38, wheelR: 6 } as const;
export const TRUCK_W = TRUCK.deck + TRUCK.gap + TRUCK.cab;
const HUB_R = 2;
const DRIVER_R = 2.6;

/** The one wheel glyph (trucks, tractor, spreader): a tyre standing on the ground and a solid hub. */
export function Wheel({ cx, r }: { cx: number; r: number }) {
  return (
    <>
      <circle cx={cx} cy={G - r} r={r} fill={INK.knockout} />
      <circle cx={cx} cy={G - r} r={HUB_R} fill="currentColor" stroke="none" />
    </>
  );
}

function truckPaths(x: number) {
  const c = x + TRUCK.deck + TRUCK.gap;
  const { deckTop, deckBottom, cabTop } = TRUCK;
  return {
    deck: `M${x} ${deckTop} H${x + TRUCK.deck} V${deckBottom} H${x} Z`,
    chassis: `M${x + TRUCK.deck} ${deckBottom - 2} H${c}`,
    cab: `M${c} ${deckBottom} V${cabTop + 2} Q${c} ${cabTop} ${c + 2} ${cabTop} H${c + 20} Q${c + 25} ${cabTop} ${c + 25.5} ${cabTop + 6} L${c + TRUCK.cab} ${deckBottom - 2} V${deckBottom} Z`,
    window: `M${c + 4} ${cabTop + 4} H${c + 20} Q${c + 22.5} ${cabTop + 4} ${c + 23} ${cabTop + 7} L${c + 23.4} ${cabTop + 13} H${c + 4} Z`,
    door: `M${c + 4} ${cabTop + 16} V${deckBottom - 2} M${c + 8} ${cabTop + 18} H${c + 11}`,
    bumper: `M${c + TRUCK.cab} ${deckBottom - 1} H${c + TRUCK.cab + 1.5}`,
    driver: { cx: c + 14, cy: cabTop + 10.4, r: DRIVER_R },
    wheels: [x + 14, c + 14],
  };
}

export function Truck({ x, children }: { x: number; children?: ReactNode }) {
  const p = truckPaths(x);
  return (
    <>
      {children}
      <Solid d={p.deck} tint={TINT.deep} />
      <path d={p.chassis} />
      <Solid d={p.cab} tint={TINT.mid} />
      <path d={p.window} fill={INK.knockout} />
      <circle {...p.driver} fill="currentColor" fillOpacity={TINT.deep} />
      <path d={p.door} strokeWidth={DETAIL_STROKE} />
      <path d={p.bumper} />
      {p.wheels.map((cx) => (
        <Wheel key={cx} cx={cx} r={TRUCK.wheelR} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ bag */

/** The big bag (FIBC), bottom at y: soft bulging sides, a domed top when full, two lift loops. */
export const BAG = { w: 15, h: 17, loop: 4 } as const;
export function bagPath(x: number, bottom: number, full = true) {
  const { w, h } = BAG;
  const top = bottom - h;
  const close = full ? `Q${x + w / 2} ${top - 2} ${x + 1} ${top} Z` : `H${x + 1} Z`;
  return `M${x + 1} ${top} Q${x - 0.8} ${bottom - h / 2} ${x} ${bottom - 2} Q${x + 0.3} ${bottom} ${x + 2.5} ${bottom} H${x + w - 2.5} Q${x + w - 0.3} ${bottom} ${x + w} ${bottom - 2} Q${x + w + 0.8} ${bottom - h / 2} ${x + w - 1} ${top} ${close}`;
}
export function bagLoops(x: number, bottom: number) {
  const top = bottom - BAG.h - 0.5;
  const { w, loop } = BAG;
  return `M${x + 1.5} ${top} Q${x + 2.5} ${top - loop} ${x + 4.5} ${top - 0.6} M${x + w - 4.5} ${top - 0.6} Q${x + w - 2.5} ${top - loop} ${x + w - 1.5} ${top}`;
}
export function Bag({ x, bottom, full = true }: { x: number; bottom: number; full?: boolean }) {
  return (
    <>
      <Solid d={bagPath(x, bottom, full)} tint={TINT.mid} />
      <path d={bagLoops(x, bottom)} />
    </>
  );
}

/* ----------------------------------------------------------------- pine */

/** A plantation pine: a three-tier crown on a bare trunk. */
export function pineCrown(x: number, top: number, base: number, half: number) {
  const t1 = top + (base - top) * 0.36;
  const t2 = top + (base - top) * 0.68;
  const left = [
    [x - half * 0.48, t1],
    [x - half * 0.26, t1 - 1],
    [x - half * 0.78, t2],
    [x - half * 0.52, t2 - 1],
    [x - half, base],
  ] as const;
  const right = [...left].reverse().map(([px, py]) => [2 * x - px, py] as const);
  return `M${x} ${top} ${[...left, ...right].map((p) => `L${pt(p)}`).join(" ")} Z`;
}

/* ---------------------------------------------------------------- maize */

/** A maize plant: a stalk, four arching leaves, a tassel and one cob. */
export function maizePlant(x: number, height: number, flip = false) {
  const s = flip ? -1 : 1;
  const top = G - height;
  const leaf = (y: number, dir: number, reach: number, droop: number) =>
    `M${x} ${y} Q${x + dir * s * reach * 0.55} ${y - droop * 1.4} ${x + dir * s * reach} ${y + droop * 0.4}`;
  const k = height / 30;
  return [
    `M${x} ${G} Q${x + s * 0.6} ${G - height * 0.5} ${x} ${top}`,
    leaf(G - 9 * k, 1, 8 * k, 5 * k),
    leaf(G - 14 * k, -1, 7.5 * k, 5 * k),
    leaf(G - 19.5 * k, 1, 7 * k, 4.5 * k),
    leaf(G - 24.5 * k, -1, 5.5 * k, 4 * k),
    `M${x} ${top} L${x - 2.6} ${top - 3.4} M${x} ${top} L${x + 2.4} ${top - 3.8} M${x} ${top} V${top - 4.4}`,
  ].join(" ");
}
export function maizeCob(x: number, height: number, flip = false) {
  const s = flip ? -1 : 1;
  const cy = G - height * 0.52;
  return `M${x + s * 0.8} ${cy + 3} Q${x + s * 4} ${cy} ${x + s * 3} ${cy - 4} Q${x + s * 1} ${cy - 1} ${x + s * 0.8} ${cy + 3} Z`;
}

/* -------------------------------------------------------------- tractor */

/** A small tractor facing right, its tail at x: a closed cab, a long hood, an exhaust, a big rear and a small front wheel. */
export const TRACTOR = { rearR: 9, frontR: 5, length: 42 } as const;
function tractorPaths(x: number) {
  const hoodTop = G - 22;
  return {
    hood: `M${x + 17} ${G - 12} V${hoodTop} H${x + 39} Q${x + 42} ${hoodTop} ${x + 42} ${hoodTop + 3} V${G - 12} Z`,
    grille: `M${x + 38} ${hoodTop + 4} V${G - 14}`,
    cab: `M${x + 3} ${G - 15} V${G - 35} Q${x + 3} ${G - 37} ${x + 5} ${G - 37} H${x + 19} Q${x + 21} ${G - 37} ${x + 21} ${G - 35} L${x + 22} ${G - 15} Z`,
    window: `M${x + 6} ${G - 34} H${x + 18.4} L${x + 19.2} ${G - 24} H${x + 6} Z`,
    exhaust: `M${x + 34} ${hoodTop} V${G - 31} M${x + 32.6} ${G - 31} H${x + 35.4}`,
    hitch: `M${x + 2} ${G - 8} H${x - 4}`,
    rear: x + 11,
    front: x + 34,
  };
}
export function Tractor({ x }: { x: number }) {
  const p = tractorPaths(x);
  return (
    <>
      <path d={p.hitch} />
      <path d={p.exhaust} />
      <Solid d={p.hood} tint={TINT.mid} />
      <path d={p.grille} strokeWidth={DETAIL_STROKE} />
      <Solid d={p.cab} tint={TINT.light} />
      <path d={p.window} fill={INK.knockout} />
      <Wheel cx={p.rear} r={TRACTOR.rearR} />
      <Wheel cx={p.front} r={TRACTOR.frontR} />
    </>
  );
}

/** The spreader, its tail at x: a hopper heaped with biochar on one wheel, a spinning disc under its tail. */
export const SPREADER = { width: 22, wheelR: 5 } as const;
function spreaderPaths(x: number) {
  const w = SPREADER.width;
  const top = G - 29;
  const bottom = G - 17;
  return {
    hopper: `M${x} ${top} H${x + w} L${x + w - 5} ${bottom} H${x + 5} Z`,
    load: `M${x + 1} ${top} Q${x + w / 2} ${top - 6} ${x + w - 1} ${top}`,
    frame: `M${x + 5} ${bottom} V${G - 12} M${x + w - 5} ${bottom} V${G - 12} M${x + 1} ${G - 12} H${x + w + 4}`,
    chute: `M${x + 5} ${bottom + 1} L${x + 1} ${G - 12}`,
    disc: `M${x - 3} ${G - 12} H${x + 3}`,
    wheel: x + w / 2 + 2,
  };
}
/** Where the grains leave the spinning disc. */
export const spreaderDisc = (x: number): Point => [x - 3, G - 12];
export function Spreader({ x }: { x: number }) {
  const p = spreaderPaths(x);
  return (
    <>
      <path d={p.frame} />
      <path d={p.chute} />
      <path d={p.disc} />
      <path d={p.load} fill="currentColor" fillOpacity={TINT.char} />
      <Solid d={p.hopper} tint={TINT.mid} />
      <Wheel cx={p.wheel} r={SPREADER.wheelR} />
    </>
  );
}
