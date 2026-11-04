/**
 * Flow chart edge geometry: the bezier between two columns and where the lit
 * edges' mass chips go. Pure, so placement is unit tested without a canvas.
 */
import { FLOW_COLUMN_PITCH, FLOW_NODE_SIZE } from "./chain-constants";

/** Bisection steps when finding the curve's height at a given x. */
const SEARCH_STEPS = 24;
/** Half a column gap: from a square's side to the middle of the next gap. */
const LABEL_LEAD_X = (FLOW_COLUMN_PITCH - FLOW_NODE_SIZE) / 2;
/** Chip geometry for collision checks (chain-edge.tsx renders it). */
export const LABEL_LINE_HEIGHT = 14;
const LABEL_PADDING_Y = 6;
const LABEL_SPACING = 4;
/** Chips whose anchors are this close in x share a column gap. */
const SAME_GAP_TOLERANCE = 1;
/** formatWetDryMass joins wet and dry with this; the chip stacks the parts. */
export const LABEL_PART_SEPARATOR = " · ";

interface Point {
  x: number;
  y: number;
}

function curvePoint(sourceX: number, sourceY: number, targetX: number, targetY: number, t: number): Point {
  const midX = (sourceX + targetX) / 2;
  const u = 1 - t;
  return {
    x: u * u * u * sourceX + 3 * u * t * midX + t * t * t * targetX,
    y: (u * u * u + 3 * u * u * t) * sourceY + (3 * u * t * t + t * t * t) * targetY,
  };
}

/** The curve's point at a given x (x grows monotonically along it). */
export function curvePointAtX(sourceX: number, sourceY: number, targetX: number, targetY: number, x: number): Point {
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (curvePoint(sourceX, sourceY, targetX, targetY, mid).x < x) low = mid;
    else high = mid;
  }
  return curvePoint(sourceX, sourceY, targetX, targetY, (low + high) / 2);
}

/**
 * Cubic bezier between two columns, like the buyer journey graph: it leaves
 * the source square level, bends at the midpoint, and arrives level.
 */
export function flowEdgePath(sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const midX = (sourceX + targetX) / 2;
  return `M${sourceX},${sourceY} C${midX},${sourceY} ${midX},${targetY} ${targetX},${targetY}`;
}

export interface LabelledEdge {
  id: string;
  source: string;
  target: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  text: string;
}

export function labelHeight(text: string): number {
  return text.split(LABEL_PART_SEPARATOR).length * LABEL_LINE_HEIGHT + LABEL_PADDING_Y;
}

/**
 * Where each lit edge's chip goes. Chips always sit in a column gap, never on
 * a column, so an edge that skips a column never covers its records. A fan
 * out of one record puts each chip in the gap before its target (where the
 * branches have spread apart); any other edge puts it in the gap after its
 * source (where converging branches are still apart). Chips left sharing a
 * gap are pushed apart vertically, nearest to where they want to be.
 */
export function placeEdgeLabels(edges: LabelledEdge[]): Map<string, Point> {
  const outDegree = new Map<string, number>();
  for (const graphEdge of edges) outDegree.set(graphEdge.source, (outDegree.get(graphEdge.source) ?? 0) + 1);

  const wanted = edges.map((graphEdge) => {
    const fanOut = (outDegree.get(graphEdge.source) ?? 0) > 1;
    const x = fanOut
      ? Math.max(graphEdge.targetX - LABEL_LEAD_X, graphEdge.sourceX)
      : Math.min(graphEdge.sourceX + LABEL_LEAD_X, graphEdge.targetX);
    const point = curvePointAtX(graphEdge.sourceX, graphEdge.sourceY, graphEdge.targetX, graphEdge.targetY, x);
    return { id: graphEdge.id, x, y: point.y, height: labelHeight(graphEdge.text) };
  });

  // Group chips by gap, then sweep each gap top to bottom.
  const gaps: Array<typeof wanted> = [];
  for (const chip of [...wanted].sort((left, right) => left.x - right.x)) {
    const gap = gaps.find((candidate) => Math.abs(candidate[0].x - chip.x) <= SAME_GAP_TOLERANCE);
    if (gap) gap.push(chip);
    else gaps.push([chip]);
  }
  const placed = new Map<string, Point>();
  for (const gap of gaps) {
    gap.sort((left, right) => left.y - right.y || left.id.localeCompare(right.id));
    const ys = gap.map((chip) => chip.y);
    for (let index = 1; index < gap.length; index += 1) {
      const minimum = ys[index - 1] + (gap[index - 1].height + gap[index].height) / 2 + LABEL_SPACING;
      ys[index] = Math.max(ys[index], minimum);
    }
    // Centre the pushed stack on where the chips wanted to be.
    const shift = gap.reduce((sum, chip, index) => sum + (chip.y - ys[index]), 0) / gap.length;
    gap.forEach((chip, index) => placed.set(chip.id, { x: chip.x, y: ys[index] + shift }));
  }
  return placed;
}
