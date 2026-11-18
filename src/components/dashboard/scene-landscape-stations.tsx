/**
 * The six stations of the dashboard scene, each centred on its bay and
 * standing on GROUND_Y (scene-landscape-kit.tsx).
 */
"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  Bag,
  BAG,
  DETAIL_STROKE,
  Dots,
  GROUND_Y as G,
  INK,
  maizeCob,
  maizePlant,
  pineCrown,
  type Point,
  r2,
  Solid,
  Spreader,
  SPREADER,
  spreaderDisc,
  STAGE_INK,
  type StageKey,
  TINT,
  Tractor,
  Truck,
  TRUCK,
  TRUCK_W,
} from "./scene-landscape-kit";

function Station({ stage, children }: { stage: StageKey; children: ReactNode }) {
  const style: CSSProperties = { color: STAGE_INK[stage] };
  return (
    <g data-art-stage={stage} style={style}>
      {children}
    </g>
  );
}

/* ------------------------------------------------------------ suppliers */

/** The plantation's edge (four pines, back to front), a heap of forestry waste, and a truck setting off with a loose load of it. */
const PINES = [
  { x: 52, top: 44, base: 108, half: 12 },
  { x: 31, top: 58, base: 114, half: 11 },
  { x: 72, top: 62, base: 116, half: 10 },
  { x: 90, top: 78, base: 120, half: 8 },
] as const;
const PINE_SHAPES = PINES.map((p) => ({ crown: pineCrown(p.x, p.top, p.base, p.half), trunk: `M${p.x} ${p.base} V${G}` }));

/** A sawmill offcut lying from a to b: a flat sawn face below, a bark face bulging above. */
const BARK_BULGE = 1.2;
function slab(a: Point, b: Point, thickness: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const up: Point = [dy / length, -dx / length];
  const a2: Point = [a[0] + up[0] * thickness, a[1] + up[1] * thickness];
  const b2: Point = [b[0] + up[0] * thickness, b[1] + up[1] * thickness];
  const bulge: Point = [(a2[0] + b2[0]) / 2 + up[0] * BARK_BULGE, (a2[1] + b2[1]) / 2 + up[1] * BARK_BULGE];
  return `M${r2(a[0])} ${r2(a[1])} L${r2(b[0])} ${r2(b[1])} L${r2(b2[0])} ${r2(b2[1])} Q${r2(bulge[0])} ${r2(bulge[1])} ${r2(a2[0])} ${r2(a2[1])} Z`;
}
/** A forked branch: a limb from a to b and one side twig. */
const branch = (a: Point, b: Point, twig: Point) => {
  const fork: Point = [a[0] + (b[0] - a[0]) * 0.6, a[1] + (b[1] - a[1]) * 0.6];
  return `M${r2(a[0])} ${r2(a[1])} L${r2(b[0])} ${r2(b[1])} M${r2(fork[0])} ${r2(fork[1])} L${r2(twig[0])} ${r2(twig[1])}`;
};

/** The waste heap at the plantation's edge: slash and branches with offcut slabs on top. */
/** Brushwood heaps have broken, angular outlines: listed as [dx, height above the ground] corners. */
const outline = (x0: number, corners: readonly (readonly [number, number])[], base: number) =>
  `M${x0 + corners[0][0]} ${base} ${corners.map(([dx, h]) => `L${x0 + dx} ${base - h}`).join(" ")} L${x0 + corners[corners.length - 1][0]} ${base} Z`;
const WASTE_HEAP = outline(
  54,
  [
    [0, 0],
    [4, 6],
    [10, 9],
    [15, 15],
    [22, 14],
    [28, 19],
    [35, 17],
    [40, 13],
    [45, 9],
    [49, 0],
  ],
  G,
);
const WASTE_BRANCHES = [
  branch([84, G - 17], [92, G - 30], [94, G - 25]),
  branch([70, G - 14], [62, G - 26], [59, G - 21]),
  branch([95, G - 12], [101, G - 21], [104, G - 18]),
].join(" ");
const WASTE_SLABS = [slab([59, G - 7], [76, G - 12.5], 3), slab([80, G - 14.5], [95, G - 10], 3), slab([66, G - 0.5], [86, G - 1.5], 3)];
const WASTE_MARKS = `M72 ${G - 7} l3 -1 M88 ${G - 6} l-3 -1.2 M95 ${G - 4} l2.6 1`;

/** The truck's loose load: heaped above a low side board, branches and one offcut sticking out. */
const SUPPLY_TRUCK_X = 106;
const tx = (dx: number) => SUPPLY_TRUCK_X + dx;
const BOARD_TOP = G - 24;
const LOAD_BOARD = `M${tx(0)} ${BOARD_TOP} H${tx(TRUCK.deck)} V${TRUCK.deckTop} H${tx(0)} Z`;
const LOAD_HEAP = outline(
  SUPPLY_TRUCK_X,
  [
    [1, 0],
    [4, 5],
    [12, 7],
    [19, 12],
    [28, 11],
    [36, 14],
    [45, 10],
    [53, 11],
    [58, 6],
    [63, 0],
  ],
  BOARD_TOP + 1,
);
const LOAD_BRANCHES = [
  branch([tx(24), G - 34], [tx(18), G - 45], [tx(15), G - 41]),
  branch([tx(44), G - 34], [tx(51), G - 45], [tx(54), G - 41]),
].join(" ");
const LOAD_SLAB = slab([tx(10), G - 27], [tx(-5), G - 31], 2.6);
const LOAD_MARKS = `M${tx(12)} ${G - 27} l3 -1 M${tx(31)} ${G - 31} l3 1 M${tx(40)} ${G - 27} l3 -1.2 M${tx(51)} ${G - 31} l-3 1`;

export function Suppliers() {
  return (
    <Station stage="suppliers">
      {PINE_SHAPES.map(({ crown, trunk }) => (
        <g key={crown}>
          <path d={trunk} />
          <Solid d={crown} tint={TINT.deep} />
        </g>
      ))}
      <path d={WASTE_BRANCHES} />
      <Solid d={WASTE_HEAP} tint={TINT.mid} />
      <path d={WASTE_MARKS} strokeWidth={DETAIL_STROKE} />
      {WASTE_SLABS.map((d) => (
        <Solid key={d} d={d} tint={TINT.deep} />
      ))}
      <Truck x={SUPPLY_TRUCK_X}>
        <path d={LOAD_BRANCHES} />
        <Solid d={LOAD_HEAP} tint={TINT.mid} />
        <path d={LOAD_MARKS} strokeWidth={DETAIL_STROKE} />
        <Solid d={LOAD_SLAB} tint={TINT.deep} />
        <Solid d={LOAD_BOARD} tint={TINT.deep} />
      </Truck>
    </Station>
  );
}

/* ------------------------------------------------------------ feedstock */

/** An open intake shed under a pitched tin roof: a heap of wood chips, a heap of manure, and the feed hopper. */
const SHED = { left: 222, right: 358, peak: 290, eave: G - 36, ridge: G - 52, sheet: 3 } as const;
const SHED_POSTS = [230, 290, 350] as const;
/** Height of the roof's underside at x. */
const underside = (x: number) => {
  const t = Math.abs(x - SHED.peak) / (SHED.peak - SHED.left);
  return SHED.ridge + (SHED.eave - SHED.ridge) * t;
};
const ROOF = `M${SHED.left} ${SHED.eave} L${SHED.peak} ${SHED.ridge} L${SHED.right} ${SHED.eave} L${SHED.right} ${SHED.eave - SHED.sheet} L${SHED.peak} ${SHED.ridge - SHED.sheet} L${SHED.left} ${SHED.eave - SHED.sheet} Z`;
const SHED_SHADE = `M${SHED_POSTS[0]} ${G} V${underside(SHED_POSTS[0])} L${SHED.peak} ${SHED.ridge} L${SHED_POSTS[2]} ${underside(SHED_POSTS[2])} V${G} Z`;
const SHED_POST_LINES = SHED_POSTS.map((x) => `M${x} ${G} V${underside(x)}`).join(" ");
const mound = (a: number, b: number, h: number) => {
  const w = b - a;
  return `M${a} ${G} C${a + w * 0.14} ${G - h * 0.6} ${a + w * 0.32} ${G - h} ${a + w / 2} ${G - h} C${a + w * 0.68} ${G - h} ${a + w * 0.86} ${G - h * 0.6} ${b} ${G} Z`;
};
const CHIP_HEAP = mound(234, 287, 25);
const CHIP_MARKS = [
  [244, 7, 3, -1.2],
  [252, 15, 3, 1],
  [262, 9, 3, -0.8],
  [268, 19, 2.6, 1.2],
  [276, 8, 3, 0.8],
  [258, 22, -2.6, 1],
]
  .map(([x, up, dx, dy]) => `M${x} ${G - up} l${dx} ${dy}`)
  .join(" ");
/** A shovel left standing in the chip heap. */
const SHOVEL = `M279 ${G - 37} L271.5 ${G - 22} M276.6 ${G - 37.6} L281.4 ${G - 36.2}`;
const MANURE_HEAP = mound(293, 347, 19);
const MANURE_GRAINS: readonly Point[] = [
  [305, G - 6],
  [314, G - 13],
  [322, G - 7],
  [330, G - 14],
  [338, G - 5],
  [318, G - 2.5],
];
const HOPPER = { left: 360, right: 384, top: G - 46, throatHalf: 3, throat: G - 30 } as const;
const HOPPER_MID = (HOPPER.left + HOPPER.right) / 2;
const HOPPER_BODY = `M${HOPPER.left} ${HOPPER.top} H${HOPPER.right} L${HOPPER_MID + HOPPER.throatHalf} ${HOPPER.throat} H${HOPPER_MID - HOPPER.throatHalf} Z`;
const HOPPER_LEGS = `M${HOPPER.left + 3} ${HOPPER.top + 5} L${HOPPER.left + 1} ${G} M${HOPPER.right - 3} ${HOPPER.top + 5} L${HOPPER.right - 1} ${G}`;
const HOPPER_LOAD = `M${HOPPER.left + 1.5} ${HOPPER.top} Q${HOPPER_MID} ${HOPPER.top - 7} ${HOPPER.right - 1.5} ${HOPPER.top}`;
/** Where the feed belt takes the chips from the hopper. */
export const HOPPER_OUTLET: Point = [HOPPER_MID, HOPPER.throat + 4];

export function Feedstock() {
  return (
    <Station stage="feedstock">
      <path d={SHED_SHADE} fill={INK.knockout} stroke="none" />
      <path d={SHED_SHADE} fill="currentColor" fillOpacity={TINT.air} stroke="none" />
      <Solid d={CHIP_HEAP} tint={TINT.mid} />
      <path d={CHIP_MARKS} strokeWidth={DETAIL_STROKE} />
      <path d={SHOVEL} />
      <Solid d={MANURE_HEAP} tint={TINT.deep} />
      <Dots points={MANURE_GRAINS} />
      <path d={SHED_POST_LINES} />
      <Solid d={ROOF} tint={TINT.deep} />
      <path d={HOPPER_LEGS} />
      <path d={HOPPER_LOAD} fill="currentColor" fillOpacity={TINT.deep} />
      <Solid d={HOPPER_BODY} tint={TINT.mid} />
    </Station>
  );
}

/* ----------------------------------------------------------- production */

/** The hero: a container pyrolysis plant, its reactor and cyclone on the roof, a tall flue, and the quench-water tank beside it. */
const CONTAINER = { left: 432, right: 518, top: G - 36 } as const;
const CONTAINER_BODY = `M${CONTAINER.left} ${G} V${CONTAINER.top} H${CONTAINER.right} V${G} Z`;
const RIB_PITCH = 6;
const RIB_INSET = 3;
/** The furnace door: a framed hatch with a glowing slot. */
const DOOR = { x: 441, y: G - 26, width: 20, height: 15, rx: 2 } as const;
const DOOR_GLOW = { x: DOOR.x + 4, y: DOOR.y + 5, width: DOOR.width - 8, height: 4, rx: 2 } as const;
const DOOR_LATCH = `M${DOOR.x + DOOR.width + 3} ${DOOR.y + 4} V${DOOR.y + DOOR.height - 4}`;
const RIB_PITCH_WIDE = RIB_PITCH * 1.5;
const RIBS = Array.from({ length: Math.floor((CONTAINER.right - CONTAINER.left - 2 * RIB_INSET) / RIB_PITCH_WIDE) + 1 }, (_, i) => CONTAINER.left + RIB_INSET + i * RIB_PITCH_WIDE)
  .filter((x) => x < DOOR.x - 2 || x > DOOR.x + DOOR.width + 2)
  .map((x) => `M${r2(x)} ${CONTAINER.top + RIB_INSET} V${G - RIB_INSET}`)
  .join(" ");
const REACTOR = { left: 440, right: 466, top: G - 80, dome: 8 } as const;
const REACTOR_MID = (REACTOR.left + REACTOR.right) / 2;
const REACTOR_BODY = `M${REACTOR.left} ${CONTAINER.top} V${REACTOR.top} Q${REACTOR.left} ${REACTOR.top - REACTOR.dome} ${REACTOR_MID} ${REACTOR.top - REACTOR.dome} Q${REACTOR.right} ${REACTOR.top - REACTOR.dome} ${REACTOR.right} ${REACTOR.top} V${CONTAINER.top} Z`;
const REACTOR_BANDS = [G - 50, G - 66].map((y) => `M${REACTOR.left} ${y} H${REACTOR.right}`).join(" ");
/** The feed belt arrives here, on the reactor's left shoulder. */
export const REACTOR_INLET: Point = [REACTOR.left - 4, G - 72];
const INLET_NOZZLE = `M${REACTOR_INLET[0]} ${REACTOR_INLET[1] - 3} H${REACTOR.left} M${REACTOR_INLET[0]} ${REACTOR_INLET[1] + 3} H${REACTOR.left}`;
const CYCLONE = { left: 476, right: 492, top: G - 78, waist: G - 66, tip: G - 50 } as const;
const CYCLONE_MID = (CYCLONE.left + CYCLONE.right) / 2;
const CYCLONE_BODY = `M${CYCLONE.left} ${CYCLONE.top} H${CYCLONE.right} V${CYCLONE.waist} L${CYCLONE_MID + 2} ${CYCLONE.tip} H${CYCLONE_MID - 2} L${CYCLONE.left} ${CYCLONE.waist} Z`;
const CYCLONE_LEG = `M${CYCLONE_MID} ${CYCLONE.tip} V${CONTAINER.top}`;
const FLUE = { left: 501, right: 509, top: 30 } as const;
const FLUE_MID = (FLUE.left + FLUE.right) / 2;
const FLUE_BODY = `M${FLUE.left} ${CONTAINER.top} V${FLUE.top} H${FLUE.right} V${CONTAINER.top} Z`;
const FLUE_CAP = `M${FLUE.left - 2} ${FLUE.top} H${FLUE.right + 2}`;
const FLUE_JOINTS = [FLUE.top + 20, FLUE.top + 44].map((y) => `M${FLUE.left} ${y} H${FLUE.right}`).join(" ");
const DUCTS = `M${REACTOR.right} ${G - 74} H${CYCLONE.left} M${CYCLONE_MID} ${CYCLONE.top} V${G - 86} H${FLUE.left}`;
/** A soft plume leaving the flue and drifting right on the breeze. */
const plume = (dx: number, dy: number) => `${r2(FLUE_MID + dx)} ${r2(FLUE.top + dy)}`;
const SMOKE_PLUME = `M${plume(-2, -3)} Q${plume(-5, -7)} ${plume(-1, -9)} Q${plume(-1, -14)} ${plume(5, -14)} Q${plume(8, -19)} ${plume(14, -17)} Q${plume(20, -20)} ${plume(23, -15)} Q${plume(27, -12)} ${plume(22, -10)} Q${plume(18, -7)} ${plume(13, -9)} Q${plume(9, -6)} ${plume(5, -7)} Q${plume(3, -3)} ${plume(2, -3)} Z`;
const SMOKE_OPACITY = 0.55;
const TANK = { left: 525, right: 541, top: G - 25, dome: 3 } as const;
const TANK_MID = (TANK.left + TANK.right) / 2;
const TANK_BODY = `M${TANK.left} ${G} V${TANK.top + TANK.dome} Q${TANK.left} ${TANK.top} ${TANK_MID} ${TANK.top} Q${TANK.right} ${TANK.top} ${TANK.right} ${TANK.top + TANK.dome} V${G} Z`;
const TANK_BANDS = [G - 9, G - 17].map((y) => `M${TANK.left} ${y} H${TANK.right}`).join(" ");
const TANK_PIPE = `M${TANK.left} ${G - 5} H${CONTAINER.right}`;
/** The discharge auger leaves the container roof here. */
export const PLANT_OUTLET: Point = [CONTAINER.right - 4, CONTAINER.top - 2];

export function Production() {
  return (
    <Station stage="production">
      <Solid d={FLUE_BODY} tint={TINT.mid} />
      <path d={FLUE_JOINTS} strokeWidth={DETAIL_STROKE} />
      <path d={FLUE_CAP} />
      <g className="scene-smoke" opacity={SMOKE_OPACITY}>
        <Solid d={SMOKE_PLUME} tint={TINT.air} />
      </g>
      <path d={DUCTS} />
      <path d={INLET_NOZZLE} />
      <Solid d={REACTOR_BODY} tint={TINT.deep} />
      <path d={REACTOR_BANDS} strokeWidth={DETAIL_STROKE} />
      <Solid d={CYCLONE_BODY} tint={TINT.mid} />
      <path d={CYCLONE_LEG} />
      <Solid d={CONTAINER_BODY} tint={TINT.light} />
      <path d={RIBS} strokeWidth={DETAIL_STROKE} />
      <rect {...DOOR} fill={INK.knockout} />
      <rect {...DOOR_GLOW} fill="currentColor" fillOpacity={TINT.char} stroke="none" />
      <path d={DOOR_LATCH} />
      <path d={TANK_PIPE} />
      <Solid d={TANK_BODY} tint={TINT.mid} />
      <path d={TANK_BANDS} strokeWidth={DETAIL_STROKE} />
    </Station>
  );
}

/* ------------------------------------------------------------- products */

/** A filling frame with a bag under the spout on its pallet, and the full bags stacked beside it. */
const FRAME = { left: 606, right: 640, top: G - 58, hooks: G - 29 } as const;
export const FRAME_MID = (FRAME.left + FRAME.right) / 2;
const FRAME_LINES = `M${FRAME.left} ${G} V${FRAME.top} M${FRAME.right} ${G} V${FRAME.top} M${FRAME.left - 4} ${FRAME.top} H${FRAME.right + 4} M${FRAME.left} ${FRAME.hooks} H${FRAME.right} M${FRAME.left - 4} ${G} H${FRAME.left + 4} M${FRAME.right - 4} ${G} H${FRAME.right + 4}`;
const PALLET_H = 3;
const FILL_BAG_X = FRAME_MID - BAG.w / 2;
const FILL_BAG_BOTTOM = G - PALLET_H;
const PALLET = `M${FILL_BAG_X - 2} ${FILL_BAG_BOTTOM} H${FILL_BAG_X + BAG.w + 2} M${FILL_BAG_X} ${FILL_BAG_BOTTOM} V${G} M${FILL_BAG_X + BAG.w / 2} ${FILL_BAG_BOTTOM} V${G} M${FILL_BAG_X + BAG.w} ${FILL_BAG_BOTTOM} V${G}`;
const FILL_BAG_TOP = FILL_BAG_BOTTOM - BAG.h;
const STRAPS = `M${FILL_BAG_X + 3} ${FILL_BAG_TOP - BAG.loop / 2 - 0.5} V${FRAME.hooks} M${FILL_BAG_X + BAG.w - 3} ${FILL_BAG_TOP - BAG.loop / 2 - 0.5} V${FRAME.hooks}`;
const SPOUT_HALF = 2.2;
const SPOUT_BOTTOM = FILL_BAG_TOP - 3;
/** The spout hangs from the beam; the auger meets its top. */
export const SPOUT_TOP: Point = [FRAME_MID, FRAME.top - 4];
const SPOUT = `M${FRAME_MID - SPOUT_HALF} ${SPOUT_TOP[1]} V${SPOUT_BOTTOM} M${FRAME_MID + SPOUT_HALF} ${SPOUT_TOP[1]} V${SPOUT_BOTTOM}`;
const FALLING: readonly Point[] = [[FRAME_MID, SPOUT_BOTTOM + 1.5]];
const STACK_X = 654;
const STACK_GAP = 2;
const STACK_BOTTOM_ROW = [0, 1, 2].map((i) => STACK_X + i * (BAG.w + STACK_GAP));
const STACK_TOP_X = STACK_X + (BAG.w + STACK_GAP) / 2;
const STACK_TOP_BOTTOM = G - BAG.h - 1;

export function Products() {
  return (
    <Station stage="products">
      <path d={FRAME_LINES} />
      <path d={STRAPS} />
      <path d={PALLET} />
      <Bag x={FILL_BAG_X} bottom={FILL_BAG_BOTTOM} full={false} />
      <path d={SPOUT} />
      <Dots points={FALLING} className="scene-fall" />
      {STACK_BOTTOM_ROW.map((x) => (
        <Bag key={x} x={x} bottom={G} />
      ))}
      <Bag x={STACK_TOP_X} bottom={STACK_TOP_BOTTOM} />
    </Station>
  );
}

/* ----------------------------------------------------------- deliveries */

/** The truck on its way to the farms, loaded high: four bags on the deck, three more on top. */
const DELIVERY_TRUCK_X = 840 - TRUCK_W / 2;
const LOAD_PITCH = BAG.w + 0.8;
const LOAD_XS = [0, 1, 2, 3].map((i) => DELIVERY_TRUCK_X + 1.5 + i * LOAD_PITCH);
const LOAD_TOP_XS = [0, 1, 2].map((i) => DELIVERY_TRUCK_X + 1.5 + LOAD_PITCH / 2 + i * LOAD_PITCH);
const LOAD_TOP_BOTTOM = TRUCK.deckTop - BAG.h - 1;

export function Deliveries() {
  return (
    <Station stage="deliveries">
      <Truck x={DELIVERY_TRUCK_X}>
        {LOAD_XS.map((x) => (
          <Bag key={x} x={x} bottom={TRUCK.deckTop} />
        ))}
        {LOAD_TOP_XS.map((x) => (
          <Bag key={x} x={x} bottom={LOAD_TOP_BOTTOM} />
        ))}
      </Truck>
    </Station>
  );
}

/* --------------------------------------------------------- applications */

/** A smallholder plot: maize, fresh ridges, a tractor pulling a spreader that broadcasts biochar over them, and an acacia. */
const MAIZE = [
  { x: 938, h: 31, flip: false },
  { x: 951, h: 35, flip: true },
  { x: 964, h: 32, flip: false },
] as const;
const MAIZE_PATH = MAIZE.map((p) => maizePlant(p.x, p.h, p.flip)).join(" ");
const MAIZE_COBS = MAIZE.map((p) => maizeCob(p.x, p.h, p.flip));
const RIDGE = { start: 968, width: 11, count: 3, height: 5 } as const;
const RIDGES = `M${RIDGE.start} ${G} ${Array.from({ length: RIDGE.count }, (_, i) => {
  const x = RIDGE.start + i * RIDGE.width;
  return `Q${x + RIDGE.width / 2} ${G - RIDGE.height * 2} ${x + RIDGE.width} ${G}`;
}).join(" ")}`;
const SPREADER_X = 1000;
const HITCH_GAP = 4;
const TRACTOR_X = SPREADER_X + SPREADER.width + HITCH_GAP + HITCH_GAP;
const DISC = spreaderDisc(SPREADER_X);
/** The fan: grains thrown back off the disc in three loose arcs, and the first ones landed on the ridges. */
const FAN_RAYS_DEG = [-26, -7, 12, 31] as const;
const FAN_STEPS = [7, 13.5, 19.5] as const;
const FAN_REACH = 25;
const FAN_JITTER = [0.8, -0.9, 0.5, -0.4] as const;
const DEG = Math.PI / 180;
const FAN: readonly Point[] = FAN_RAYS_DEG.flatMap((deg, ray) => {
  const steps = ray === 1 || ray === 2 ? [...FAN_STEPS, FAN_REACH] : FAN_STEPS;
  return steps.map((d, i) => {
    const reach = d + FAN_JITTER[(ray + i) % FAN_JITTER.length];
    return [r2(DISC[0] - reach * Math.cos(deg * DEG)), r2(DISC[1] + reach * Math.sin(deg * DEG))] as const;
  });
});
const LANDED: readonly Point[] = [0.5, 1.5].map((i) => [RIDGE.start + RIDGE.width * i, G - RIDGE.height - 1.6] as const);
const ACACIA = { x: 1104 } as const;
const ACACIA_FORK = G - 24;
const ACACIA_UNDER = G - 39;
const ACACIA_TRUNK = `M${ACACIA.x - 1} ${G} Q${ACACIA.x} ${G - 12} ${ACACIA.x - 1} ${ACACIA_FORK} M${ACACIA.x + 2} ${G} Q${ACACIA.x + 2.6} ${G - 12} ${ACACIA.x + 1.6} ${ACACIA_FORK} M${ACACIA.x - 1} ${ACACIA_FORK} Q${ACACIA.x - 8} ${G - 31} ${ACACIA.x - 20} ${ACACIA_UNDER} M${ACACIA.x} ${ACACIA_FORK} Q${ACACIA.x + 1} ${G - 32} ${ACACIA.x - 2} ${ACACIA_UNDER} M${ACACIA.x + 1.6} ${ACACIA_FORK} Q${ACACIA.x + 9} ${G - 30} ${ACACIA.x + 19} ${ACACIA_UNDER}`;
const ACACIA_CROWN = `M${ACACIA.x - 37} ${G - 41} Q${ACACIA.x - 36} ${G - 47} ${ACACIA.x - 27} ${G - 47.5} Q${ACACIA.x - 21} ${G - 52.5} ${ACACIA.x - 9} ${G - 50.5} Q${ACACIA.x + 1} ${G - 54.5} ${ACACIA.x + 12} ${G - 50.5} Q${ACACIA.x + 24} ${G - 52.5} ${ACACIA.x + 30} ${G - 47.5} Q${ACACIA.x + 38} ${G - 47} ${ACACIA.x + 37} ${G - 41} Q${ACACIA.x + 18} ${ACACIA_UNDER - 1} ${ACACIA.x} ${ACACIA_UNDER} Q${ACACIA.x - 18} ${ACACIA_UNDER - 1} ${ACACIA.x - 37} ${G - 41} Z`;

export function Applications() {
  return (
    <Station stage="applications">
      <path d={MAIZE_PATH} />
      {MAIZE_COBS.map((d) => (
        <Solid key={d} d={d} tint={TINT.deep} />
      ))}
      <path d={RIDGES} />
      <path d={ACACIA_TRUNK} />
      <Solid d={ACACIA_CROWN} tint={TINT.light} />
      <Spreader x={SPREADER_X} />
      <Tractor x={TRACTOR_X} />
      <Dots points={FAN} />
      <Dots points={LANDED} />
    </Station>
  );
}
