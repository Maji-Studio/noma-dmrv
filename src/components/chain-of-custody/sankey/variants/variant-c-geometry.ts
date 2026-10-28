/**
 * PROTOTYPE variant C geometry, pure. The ribbon is laid out in flow
 * coordinates: `u` runs along the flow, `v` across it from the baseline. The
 * desktop maps u to x and v up from the baseline; the phone maps u down the
 * page and v to the right. Each exit is the far part of the band leaving a
 * column, which turns away from the ribbon (up on a desktop, right on a
 * phone) and ends as a hatched drop, its width its kilograms.
 */

export interface RibbonNode {
  key: string;
  massKg: number;
  /** Water inside the node's mass, drawn at its far edge (the wet start). */
  waterKg?: number;
}

export interface RibbonExit {
  key: string;
  massKg: number;
  /** The link it leaves through: 0 is between the first and second node. */
  link: number;
}

export interface LaidNode {
  key: string;
  u: number;
  v: number;
  waterV: number;
}

export interface LaidExit {
  key: string;
  /** Where the band leaves the column and where it turns. */
  us: number;
  ud: number;
  /** Width of the drop along u. */
  w: number;
  vLow: number;
  vHigh: number;
  vEnd: number;
  /** Free u before the drop, the most the inner turn may take. */
  room: number;
}

export interface LaidBand {
  u0: number;
  u1: number;
  v: number;
}

export interface RibbonLayoutInput {
  nodes: readonly RibbonNode[];
  exits: readonly RibbonExit[];
  /** Px per kg across the flow. */
  scale: number;
  barT: number;
  /** u where each node bar starts. */
  nodeU: readonly number[];
  gap: number;
  /** v where every drop ends. */
  vEnd: number;
  /** Shrink drops to fit the link (desktop); a phone grows the link instead. */
  fitDrops: boolean;
}

const MIN_DROP_PX = 3;

export function layoutRibbon(input: RibbonLayoutInput) {
  const { nodes, exits, scale, barT, nodeU, gap, vEnd, fitDrops } = input;
  const laidNodes: LaidNode[] = nodes.map((node, index) => ({
    key: node.key,
    u: nodeU[index],
    v: node.massKg * scale,
    waterV: (node.waterKg ?? 0) * scale,
  }));
  const bands: LaidBand[] = [];
  const laidExits: LaidExit[] = [];
  for (let link = 0; link < nodes.length - 1; link += 1) {
    const from = laidNodes[link];
    const to = laidNodes[link + 1];
    const us = from.u + barT;
    bands.push({ u0: us, u1: to.u, v: Math.min(from.v, to.v) });
    const linkExits = exits.filter((exit) => exit.link === link);
    const thick = linkExits.map((exit) => exit.massKg * scale);
    const room = to.u - us - gap * (linkExits.length + 1);
    const total = thick.reduce((sum, value) => sum + value, 0);
    const factor = fitDrops && total > room && total > 0 ? Math.max(0, room) / total : 1;
    let vHigh = from.v;
    let ud = us + gap;
    linkExits.forEach((exit, index) => {
      const t = thick[index];
      const w = Math.max(MIN_DROP_PX, t * factor);
      laidExits.push({ key: exit.key, us, ud, w, vHigh, vLow: Math.max(0, vHigh - t), vEnd, room: gap });
      vHigh -= t;
      ud += w + gap;
    });
  }
  return { nodes: laidNodes, bands, exits: laidExits };
}

/** The u length a link needs so its drops sit at full width (phone). */
export function linkLengthFor(exitKgs: readonly number[], scale: number, gap: number, labelRoom: number): number {
  return exitKgs.reduce((sum, kg) => sum + Math.max(MIN_DROP_PX, kg * scale) + gap, gap) + labelRoom;
}

export type FlowPoint = (u: number, v: number) => [number, number];

/** Closed path of one exit band: along the flow, a turn, then the drop. */
export function exitPath(exit: LaidExit, map: FlowPoint): string {
  const { us, ud, w, vLow, vHigh, vEnd, room } = exit;
  const outerU = ud + w;
  const ro = Math.max(0, Math.min(outerU - us, (vEnd - vLow) / 2));
  const ri = Math.max(0, Math.min(room, (vEnd - vHigh) / 2, ro));
  const p = (u: number, v: number) => map(u, v).join(" ");
  return [
    `M${p(us, vLow)}`,
    `L${p(outerU - ro, vLow)}`,
    `Q${p(outerU, vLow)} ${p(outerU, vLow + ro)}`,
    `L${p(outerU, vEnd)}`,
    `L${p(ud, vEnd)}`,
    `L${p(ud, vHigh + ri)}`,
    `Q${p(ud, vHigh)} ${p(ud - ri, vHigh)}`,
    `L${p(us, vHigh)}`,
    "Z",
  ].join(" ");
}

/** Axis-aligned rectangle in flow coordinates, as x, y, width, height. */
export function flowRect(map: FlowPoint, u0: number, u1: number, v0: number, v1: number) {
  const [xa, ya] = map(u0, v0);
  const [xb, yb] = map(u1, v1);
  return { x: Math.min(xa, xb), y: Math.min(ya, yb), width: Math.abs(xb - xa), height: Math.abs(yb - ya) };
}
