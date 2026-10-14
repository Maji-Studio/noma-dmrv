/**
 * Layout for `MassFlowSankey`: where every node, band, exit, inflow and label
 * goes for one diagram at one pixel width. Pure, so the geometry is testable
 * without a DOM.
 *
 * A diagram is columns of nodes. A node is a stack of segments, one per kind
 * of mass it holds (dry matter, water, ingredient solids). A link carries one
 * segment's whole mass to a node or to one of its segments, so a band is as
 * thick as the segment it leaves. An exit carries a segment out of the
 * diagram: it rises to the label row above and fades, the way water driven
 * off or gas released leaves the process.
 * An inflow is the mirror of an exit: it brings mass into a last-column
 * segment from outside the diagram, such as water the biochar takes up after
 * the reactor. It runs in from the left just under the band arriving at that
 * node, rising into its segment as it fades in, and carries its label under
 * its faded far end, the way an exit carries its label above its own.
 *
 * A node can name its own parts. Its segments then carry labels in a column
 * beside it, each joined to its segment by a short leader, so a product shows
 * what it is made of where the bands arrive, regrouped by kind rather than
 * by where each part came from. That column's width is reserved before the
 * columns are spread.
 *
 * One vertical scale serves the whole diagram: the heaviest column fills the
 * flow height, so 4 t in and 1 t out look like it. Height is in pixels and the
 * width is the measured container width, so text never scales with the
 * picture and a phone gets the same 12px labels as a desktop.
 *
 * Column 0 stacks its nodes from the top. A later node lines its top up with
 * the first band arriving at it, so the main band runs straight and the eye
 * follows it. Every node's label sits under it, left aligned to the node,
 * except in the last column, where it is right aligned so it ends at the
 * edge. Labels that would collide step down below the one they hit.
 */

export type MassFlowKind = "dry" | "water" | "addedWater" | "solids" | "process" | "wet" | "released";

export interface MassFlowSegment {
  id: string;
  kg: number;
  kind: MassFlowKind;
  /** CSS colour for a `solids` segment, so peer ingredients draw apart. */
  fill?: string;
  /** Names the part beside its node: the name, then the figure. */
  label?: { name: string; figure: string };
}

export interface MassFlowNode {
  id: string;
  column: number;
  name: string;
  /** The figure line under the name, such as "4,000 kg wet". */
  caption?: string;
  /** The name is a placeholder for an unselected record, drawn muted. */
  placeholder?: boolean;
  segments: readonly MassFlowSegment[];
}

export interface MassFlowLink {
  /** Source segment id. */
  from: string;
  /** Target segment id, or a node id when the mass enters the node as a whole. */
  to: string;
}

export interface MassFlowExit {
  /** Source segment id. */
  from: string;
  name: string;
  caption: string;
}

/**
 * Mass entering a last-column segment from outside the diagram. Only the last
 * column takes inflows: the stub needs the gap between that column and the one
 * before it, and an inflow into any other segment is skipped.
 */
export interface MassFlowInflow {
  /** Target segment id. Its whole mass enters from outside the diagram. */
  to: string;
  name: string;
  caption: string;
}

export interface MassFlowDiagram {
  nodes: readonly MassFlowNode[];
  links: readonly MassFlowLink[];
  exits?: readonly MassFlowExit[];
  inflows?: readonly MassFlowInflow[];
}

export type LabelAlign = "left" | "right";

export interface LaidOutSegment {
  id: string;
  kind: MassFlowKind;
  fill?: string;
  y: number;
  h: number;
}

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  h: number;
  segments: LaidOutSegment[];
}

export interface LaidOutBand {
  key: string;
  kind: MassFlowKind;
  fill?: string;
  path: string;
  /** Fully visible at x0, fading towards x1. */
  fade?: { x0: number; x1: number };
}

export interface LaidOutLabel {
  key: string;
  name: string;
  caption?: string;
  placeholder?: boolean;
  align: LabelAlign;
  /** Anchor x: the left edge or the right edge, by `align`. */
  x: number;
  y: number;
  maxWidth: number;
  /**
   * A mass label (an exit, inflow or a node's part) reads as a small name over a
   * larger figure; a stop label as a larger name over a small caption.
   */
  figure?: boolean;
}

/** A hairline from a segment to its label beside the node. */
export interface LaidOutLeader {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MassFlowLayout {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  bands: LaidOutBand[];
  labels: LaidOutLabel[];
  leaders: LaidOutLeader[];
}

export const NODE_WIDTH_PX = 10;
/** Height the heaviest column fills. */
export const FLOW_HEIGHT_PX = 160;
/** A non-zero segment never draws thinner than this, so it stays visible. */
export const MIN_SEGMENT_PX = 2;
/** Line boxes of the label text: 14px and 12px type at a 150% line height. */
const LARGE_LINE_PX = 21;
const SMALL_LINE_PX = 18;
/** The gap between a label's two lines (`gap-2`). */
const LABEL_LINE_GAP_PX = 2;
/** Two text lines: a 14px name over a 12px caption, or the reverse. */
export const LABEL_HEIGHT_PX = LARGE_LINE_PX + LABEL_LINE_GAP_PX + SMALL_LINE_PX;
/** A stop label sits this far under its node. */
export const LABEL_OFFSET_PX = 6;
const LABEL_STEP_PX = 4;
/** Room above the flow for exit labels, and how far an exit rises to reach it. */
const EXIT_LABEL_PX = LABEL_HEIGHT_PX;
const EXIT_RISE_PX = 24;
/** An exit runs this share of the width before it has faded out. */
export const EXIT_SPAN_SHARE = 0.3;
/** Exit labels share the row above the flow, so each keeps to under half of it. */
const EXIT_LABEL_SHARE = 0.45;
/**
 * An inflow starts this far below its segment and rises into it, so air shows
 * between it and the band above. It keeps clear of the column before it and
 * shares the exits' span and label measure.
 */
const INFLOW_RISE_PX = 12;
const INFLOW_CLEARANCE_PX = 8;
/** The shortest stub an inflow shortens to so an upstream stop label keeps its place. */
const INFLOW_MIN_SPAN_PX = 48;
const INFLOW_SPAN_SHARE = EXIT_SPAN_SHARE;
const INFLOW_LABEL_SHARE = EXIT_LABEL_SHARE;
/** Part labels beside a node take at most this share of the width. */
const PART_LABEL_SHARE = 0.5;
/** Room for the leader between a node and its part labels. */
const LEADER_PX = 16;
const LEADER_INSET_PX = 3;
const PART_LABEL_GAP_PX = 2;
/** Rough glyph widths for collision checks when no measurer is given: 14px and 12px text. */
const NAME_CHAR_PX = 7.4;
const CAPTION_CHAR_PX = 6.6;
/** Labels side by side keep at least this much air between them. */
const LABEL_GAP_PX = 8;

/** Pixel width of a label line: the larger 14px line or the smaller 12px one. */
export type MeasureText = (text: string, size: "large" | "small") => number;

const estimateText: MeasureText = (text, size) => text.length * (size === "large" ? NAME_CHAR_PX : CAPTION_CHAR_PX);

function segmentHeight(kg: number, scale: number): number {
  return kg > 0 ? Math.max(MIN_SEGMENT_PX, kg * scale) : 0;
}

/** A band of thickness `h` from (x0, y0) to (x1, y1), both its top edge. */
export function bandPath(x0: number, y0: number, x1: number, y1: number, h: number): string {
  const mid = (x0 + x1) / 2;
  return [
    `M${x0},${y0}`,
    `C${mid},${y0} ${mid},${y1} ${x1},${y1}`,
    `L${x1},${y1 + h}`,
    `C${mid},${y1 + h} ${mid},${y0 + h} ${x0},${y0 + h}`,
    "Z",
  ].join(" ");
}

function nodeKg(node: MassFlowNode): number {
  return node.segments.reduce((total, segment) => total + Math.max(0, segment.kg), 0);
}

/** A stop label is a 14px name over a 12px caption; a mass label the reverse. */
function lineWidths(name: string, caption: string | undefined, figure: boolean | undefined, measure: MeasureText): number {
  const nameWidth = measure(name, figure ? "small" : "large");
  const captionWidth = caption ? measure(caption, figure ? "large" : "small") : 0;
  return Math.max(nameWidth, captionWidth);
}

function labelWidth(label: LaidOutLabel, measure: MeasureText): number {
  return Math.min(label.maxWidth, lineWidths(label.name, label.caption, label.figure, measure));
}

function labelSpan(label: LaidOutLabel, width: number): [number, number] {
  return label.align === "left" ? [label.x, label.x + width] : [label.x - width, label.x];
}

/** Something a label must not overlap, and where a label that hits it moves to. */
interface LabelObstacle {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface PlacedBox {
  span: [number, number];
  top: number;
  bottom: number;
  /** The top a label takes to clear this box. */
  clearAt: number;
}

/**
 * Step each label down until it clears every obstacle and every label placed
 * before it. Obstacles are shapes fixed by the flow, such as an inflow and its
 * label, so the labels around them move instead.
 */
function settleLabels(labels: LaidOutLabel[], obstacles: readonly LabelObstacle[], measure: MeasureText): LaidOutLabel[] {
  const placed: PlacedBox[] = obstacles.map((box) => ({
    span: [box.left - LABEL_GAP_PX / 2, box.right + LABEL_GAP_PX / 2],
    top: box.top,
    bottom: box.bottom,
    clearAt: box.bottom + LABEL_OFFSET_PX,
  }));
  return labels.map((label) => {
    const [start, end] = labelSpan(label, labelWidth(label, measure));
    const span: [number, number] = [start - LABEL_GAP_PX / 2, end + LABEL_GAP_PX / 2];
    let { y } = label;
    let moved = true;
    while (moved) {
      moved = false;
      for (const other of placed) {
        const xOverlap = span[0] < other.span[1] && other.span[0] < span[1];
        const yOverlap = y < other.bottom && other.top < y + LABEL_HEIGHT_PX;
        if (xOverlap && yOverlap) {
          y = other.clearAt;
          moved = true;
        }
      }
    }
    const settled = { ...label, y };
    placed.push({ span, top: y, bottom: y + LABEL_HEIGHT_PX, clearAt: y + LABEL_HEIGHT_PX + LABEL_STEP_PX });
    return settled;
  });
}

interface InflowSpan {
  /** Where the stub starts by default: its span, kept clear of the column before. */
  from: number;
  /** The target node's left edge, where the stub ends. */
  to: number;
  /** The rows the stub and its label take: from the segment top to the label bottom. */
  rows: [number, number];
  labelWidth: number;
  width: number;
  upstream: readonly LaidOutLabel[];
  measure: MeasureText;
}

/**
 * Where an inflow starts. It moves right past any upstream stop label in its
 * rows, so that label keeps its place under its node, but only while the stub
 * stays at least `INFLOW_MIN_SPAN_PX` long and its label fits before the edge.
 * Otherwise it keeps its default start and the stop labels step clear of it.
 */
function inflowStart({ from, to, rows, labelWidth: needed, width, upstream, measure }: InflowSpan): number {
  let clear = from;
  for (const label of upstream) {
    const [start, end] = labelSpan(label, labelWidth(label, measure));
    const inRows = label.y < rows[1] && rows[0] < label.y + LABEL_HEIGHT_PX;
    if (inRows && start < to && end + LABEL_GAP_PX > clear) clear = end + LABEL_GAP_PX;
  }
  const fits = to - clear >= INFLOW_MIN_SPAN_PX && width - clear >= needed;
  return fits ? clear : from;
}

export function layoutMassFlow(
  diagram: MassFlowDiagram,
  width: number,
  measure: MeasureText = estimateText,
): MassFlowLayout | null {
  const { nodes, links } = diagram;
  const exits = diagram.exits ?? [];
  const lastColumn = Math.max(0, ...nodes.map((node) => node.column));
  const columnKg = new Map<number, number>();
  for (const node of nodes) columnKg.set(node.column, (columnKg.get(node.column) ?? 0) + nodeKg(node));
  const heaviest = Math.max(0, ...columnKg.values());
  if (nodes.length === 0 || heaviest <= 0 || width <= 0) return null;

  const scale = FLOW_HEIGHT_PX / heaviest;
  const top = exits.length > 0 ? EXIT_LABEL_PX + EXIT_RISE_PX : 0;
  // A last-column node that names its parts needs their column to its right.
  const partLabels = nodes
    .filter((node) => node.column === lastColumn)
    .flatMap((node) => node.segments.flatMap((segment) => (segment.label ? [segment.label] : [])));
  const partColumn = partLabels.length === 0
    ? 0
    : Math.min(width * PART_LABEL_SHARE, Math.max(...partLabels.map((label) => lineWidths(label.name, label.figure, true, measure))) + LEADER_PX);
  const flowWidth = width - partColumn;
  const columnX = (column: number) => (lastColumn === 0 ? 0 : (column / lastColumn) * (flowWidth - NODE_WIDTH_PX));
  const nodeGap = LABEL_OFFSET_PX + LABEL_HEIGHT_PX + LABEL_STEP_PX;

  const placed = new Map<string, LaidOutNode>();
  const segmentOwner = new Map<string, LaidOutNode>();
  const segmentById = new Map<string, LaidOutSegment>();
  const columnBottom = new Map<number, number>();

  const place = (node: MassFlowNode, y: number) => {
    let cursor = y;
    const segments = node.segments.map((segment) => {
      const laid: LaidOutSegment = { id: segment.id, kind: segment.kind, fill: segment.fill, y: cursor, h: segmentHeight(segment.kg, scale) };
      cursor += laid.h;
      return laid;
    });
    const laidNode: LaidOutNode = { id: node.id, x: columnX(node.column), y, h: cursor - y, segments };
    placed.set(node.id, laidNode);
    for (const segment of segments) {
      segmentOwner.set(segment.id, laidNode);
      segmentById.set(segment.id, segment);
    }
    columnBottom.set(node.column, cursor);
  };

  const ordered = [...nodes].sort((a, b) => a.column - b.column);
  for (const node of ordered) {
    const below = columnBottom.has(node.column) ? (columnBottom.get(node.column) ?? 0) + nodeGap : top;
    const segmentIds = new Set(node.segments.map((segment) => segment.id));
    const firstIn = links.find((link) => link.to === node.id || segmentIds.has(link.to));
    const aligned = firstIn ? segmentById.get(firstIn.from)?.y : undefined;
    place(node, Math.max(below, aligned ?? top));
  }

  const bands: LaidOutBand[] = [];
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  for (const link of links) {
    const source = segmentById.get(link.from);
    const sourceNode = segmentOwner.get(link.from);
    const targetNode = placed.get(link.to) ?? segmentOwner.get(link.to);
    if (!source || !sourceNode || !targetNode || source.h <= 0) continue;
    const targetTop = placed.get(link.to)?.y ?? segmentById.get(link.to)?.y ?? targetNode.y;
    const targetH = placed.get(link.to)?.h ?? segmentById.get(link.to)?.h ?? targetNode.h;
    const enteredSoFar = inOffset.get(link.to) ?? 0;
    // Slivers held at the minimum height can add up to more than the segment
    // they pool into; the last ones overlap inside it rather than spill past it.
    const entry = Math.min(enteredSoFar, Math.max(0, targetH - source.h));
    const leftSoFar = outOffset.get(link.from) ?? 0;
    // A band is the mass it delivers: into a segment it takes that segment's
    // kind (the reactor's output arrives as dry biochar), into a whole node
    // the kind it left as.
    const delivered = segmentById.get(link.to) ?? source;
    bands.push({
      key: `${link.from}->${link.to}`,
      kind: delivered.kind,
      fill: delivered.fill,
      path: bandPath(sourceNode.x + NODE_WIDTH_PX, source.y + leftSoFar, targetNode.x, targetTop + entry, source.h),
    });
    inOffset.set(link.to, enteredSoFar + source.h);
    outOffset.set(link.from, leftSoFar + source.h);
  }

  // Part labels go first, so the stop labels step around them: each sits
  // level with its segment, nudged down only to clear the one above.
  const labels: LaidOutLabel[] = [];
  const partOf = new Map<string, LaidOutSegment>();
  for (const node of nodes) {
    const laid = placed.get(node.id);
    if (!laid) continue;
    let floor = 0;
    for (const segment of node.segments) {
      const laidSegment = segmentById.get(segment.id);
      if (!segment.label || !laidSegment || laidSegment.h <= 0) continue;
      const x = laid.x + NODE_WIDTH_PX + LEADER_PX;
      const y = Math.max(floor, laidSegment.y + laidSegment.h / 2 - LABEL_HEIGHT_PX / 2);
      floor = y + LABEL_HEIGHT_PX + PART_LABEL_GAP_PX;
      partOf.set(`part-${segment.id}`, laidSegment);
      labels.push({
        key: `part-${segment.id}`,
        name: segment.label.name,
        caption: segment.label.figure,
        align: "left",
        x,
        y,
        maxWidth: width - x,
        figure: true,
      });
    }
  }
  const stops: LaidOutLabel[] = [];
  const upstreamStops: LaidOutLabel[] = [];
  for (const node of nodes) {
    const laid = placed.get(node.id);
    if (!laid) continue;
    const namesParts = node.segments.some((segment) => segment.label);
    const align: LabelAlign = node.column === lastColumn && lastColumn > 0 && !namesParts ? "right" : "left";
    const x = align === "left" ? laid.x : laid.x + NODE_WIDTH_PX;
    const stop: LaidOutLabel = {
      key: node.id,
      name: node.name,
      caption: node.caption,
      placeholder: node.placeholder,
      align,
      x,
      y: laid.y + laid.h + LABEL_OFFSET_PX,
      maxWidth: align === "left" ? width - x : x,
    };
    stops.push(stop);
    if (node.column < lastColumn) upstreamStops.push(stop);
  }

  // Inflows come next and hold their place: each runs in from the left under
  // the band arriving at its node, rising into its segment, with its label
  // under the far end. It starts past the upstream stop labels in its rows
  // when the stub and its label still fit there; otherwise the stop labels
  // step clear of it.
  const obstacles: LabelObstacle[] = [];
  const upstreamSettled = settleLabels([...labels, ...upstreamStops], [], measure);
  const inflowTargets = new Set(lastColumn === 0 ? [] : nodes
    .filter((node) => node.column === lastColumn)
    .flatMap((node) => node.segments.map((segment) => segment.id)));
  const inflowFrom = columnX(lastColumn - 1) + NODE_WIDTH_PX + INFLOW_CLEARANCE_PX;
  for (const inflow of diagram.inflows ?? []) {
    const target = segmentById.get(inflow.to);
    const targetNode = segmentOwner.get(inflow.to);
    if (!target || !targetNode || target.h <= 0 || !inflowTargets.has(inflow.to)) continue;
    const x1 = targetNode.x;
    const startY = target.y + INFLOW_RISE_PX;
    const labelY = startY + target.h + LABEL_OFFSET_PX;
    const x0 = inflowStart({
      from: Math.max(inflowFrom, x1 - width * INFLOW_SPAN_SHARE),
      to: x1,
      rows: [target.y, labelY + LABEL_HEIGHT_PX],
      labelWidth: lineWidths(inflow.name, inflow.caption, true, measure),
      width,
      upstream: upstreamSettled.filter((label) => !label.figure),
      measure,
    });
    if (x0 >= x1) continue;
    bands.push({
      key: `inflow->${inflow.to}`,
      kind: target.kind,
      fill: target.fill,
      path: bandPath(x0, startY, x1, target.y, target.h),
      fade: { x0: x1, x1: x0 },
    });
    obstacles.push({ left: x0, right: x1, top: target.y, bottom: startY + target.h });
    labels.push({
      key: `${inflow.to}-inflow`,
      name: inflow.name,
      caption: inflow.caption,
      align: "left",
      x: x0,
      y: labelY,
      maxWidth: Math.min(width - x0, width * INFLOW_LABEL_SHARE),
      figure: true,
    });
  }
  labels.push(...stops);

  for (const exit of exits) {
    const source = segmentById.get(exit.from);
    const sourceNode = segmentOwner.get(exit.from);
    if (!source || !sourceNode || source.h <= 0) continue;
    const x0 = sourceNode.x + NODE_WIDTH_PX;
    const x1 = Math.min(width, x0 + width * EXIT_SPAN_SHARE);
    bands.push({
      key: `${exit.from}->exit`,
      kind: source.kind,
      fill: source.fill,
      path: bandPath(x0, source.y, x1, EXIT_LABEL_PX, source.h),
      fade: { x0, x1 },
    });
    labels.push({
      key: `${exit.from}-exit`,
      name: exit.name,
      caption: exit.caption,
      align: "right",
      x: x1,
      y: 0,
      maxWidth: Math.min(x1, width * EXIT_LABEL_SHARE),
      figure: true,
    });
  }

  const settled = settleLabels(labels, obstacles, measure);
  const leaders = settled.flatMap((label): LaidOutLeader[] => {
    const segment = partOf.get(label.key);
    if (!segment) return [];
    return [{
      key: label.key,
      x1: label.x - LEADER_PX + LEADER_INSET_PX,
      y1: segment.y + segment.h / 2,
      x2: label.x - LEADER_INSET_PX,
      y2: label.y + LABEL_HEIGHT_PX / 2,
    }];
  });
  const nodeBottom = Math.max(...[...placed.values()].map((node) => node.y + node.h));
  const labelBottom = Math.max(...settled.map((label) => label.y + LABEL_HEIGHT_PX));
  return {
    width,
    height: Math.ceil(Math.max(nodeBottom, labelBottom)),
    nodes: [...placed.values()],
    bands,
    // Reading order: the stops first, then the masses that enter, leave or make them up.
    labels: [...settled.filter((label) => !label.figure), ...settled.filter((label) => label.figure)],
    leaders,
  };
}
