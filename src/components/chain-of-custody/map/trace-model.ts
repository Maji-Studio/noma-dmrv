/**
 * Pure model of the batch Traceability Map: the batch's records grouped into
 * stages in chain order, which legs and records a selection lights, and the
 * camera frame it asks for. No React, no MapLibre; unit-tested. Chains (one
 * path from a supplier to one end) live in `trace-chains.ts`.
 */
import type { Edge, Node } from "@xyflow/react";
import type { Icon } from "@phosphor-icons/react";
import type {
  ChainGeoLeg,
  ChainGeoPositionSource,
  ChainOfCustodyGeoData,
} from "@/data-access/chain-of-custody-geo";
import type { GeoPoint } from "@/lib/geo/types";
import { recordHref } from "@/lib/record-links";
import { LINEAGE_NODE_STYLES, type LineageNodeKind } from "../chain-constants";
import type { ChainNodeData } from "../chain-node";
import { reachableNodeIds, type LineageDetailRow } from "../use-chain-graph";
import { legAnchorNodeId, resolveLegEndpoints, type PlottableLeg } from "./viewer-utils";

/** Stage order on the map: the reactor is equipment, so it has no stage. */
export const STAGE_KINDS: readonly LineageNodeKind[] = [
  "feedstock",
  "productionRun",
  "biocharProduct",
  "order",
  "delivery",
  "application",
];

/** Stage titles in operator words. */
const STAGE_TITLES: Partial<Record<LineageNodeKind, string>> = {
  feedstock: "Feedstock intake",
  biocharProduct: "Biochar product",
};

/** Km are stored to one decimal; sums are rounded back to it. */
const KM_ROUNDING = 10;

export interface TraceRecord {
  id: string;
  kind: LineageNodeKind;
  /** Kind label ("Production run"). */
  label: string;
  /** Record code shown in lists (run, product, delivery code; field for an application). */
  shortCode: string;
  /** Longer heading the Flow sheet uses. */
  code: string;
  date: string | null;
  status: string | null;
  details: LineageDetailRow[];
  /** The record on its list, on the batch's facility (`recordHref`). */
  href: string | null;
  drillable: boolean;
  icon: Icon;
  accent: string;
  accentInk: string;
  /** Where the map shows it; null = it lives at the facility. */
  position: GeoPoint | null;
  positionSource: ChainGeoPositionSource;
  /** Secondary marker label (supplier name, field identifier). */
  sub: string | null;
  /** The geo payload's own code (an application's AP code under its field name). */
  geoCode: string | null;
}

export interface TraceStage {
  kind: LineageNodeKind;
  title: string;
  /** Lower-case singular noun for counts ("production run"). */
  singular: string;
  plural: string;
  icon: Icon;
  accent: string;
  accentInk: string;
  records: TraceRecord[];
}

/** What a selection does to the map: what stays lit and what the camera frames. */
export interface MapLighting {
  /** Lit records; null = nothing focused, everything at rest. */
  nodeIds: Set<string> | null;
  /** Lit legs, the only ones that carry a km label. */
  legIds: Set<string>;
  /** Camera frame; empty = leave the camera alone. */
  points: GeoPoint[];
  /** The facility stays the pivot of this selection (ring it). */
  facilityLit: boolean;
  /** A ring on the one current record. */
  currentNodeId: string | null;
}

export interface TraceModel {
  stages: TraceStage[];
  records: Map<string, TraceRecord>;
  facility: GeoPoint | null;
  facilityName: string;
  edges: Edge[];
  geo: ChainOfCustodyGeoData;
  /** Legs with both ends on the map, by leg id. */
  plottable: Map<string, PlottableLeg>;
}

export const numericCompare = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true });

function nodeData(node: Node): ChainNodeData {
  return node.data as unknown as ChainNodeData;
}

/** `kind:entityId` node ids carry the record id after the first colon. */
function entityIdOf(nodeId: string): string {
  return nodeId.slice(nodeId.indexOf(":") + 1);
}

export function buildTraceModel(
  nodes: Node[],
  edges: Edge[],
  geo: ChainOfCustodyGeoData,
): TraceModel {
  const geoById = new Map(geo.nodes.map((node) => [node.id, node]));
  const records = new Map<string, TraceRecord>();
  for (const node of nodes) {
    const data = nodeData(node);
    if (!STAGE_KINDS.includes(data.kind)) continue;
    const geoNode = geoById.get(node.id);
    const own =
      geoNode &&
      (geoNode.positionSource === "own" || geoNode.positionSource === "leg_origin") &&
      geoNode.lat != null &&
      geoNode.lng != null
        ? { lat: geoNode.lat, lng: geoNode.lng }
        : null;
    records.set(node.id, {
      id: node.id,
      kind: data.kind,
      label: data.label,
      shortCode: data.shortCode,
      code: data.code,
      date: data.date,
      status: data.status ?? null,
      details: data.details,
      href: recordHref(data.kind, entityIdOf(node.id), { facilityId: geo.facility.id }),
      drillable: data.drillable === true,
      icon: data.icon,
      accent: data.accent,
      accentInk: data.accentInk,
      position: own,
      positionSource: geoNode?.positionSource ?? "facility",
      sub: geoNode?.sub ?? null,
      geoCode: geoNode?.code ?? null,
    });
  }
  const stages: TraceStage[] = STAGE_KINDS.flatMap((kind) => {
    const members = [...records.values()]
      .filter((record) => record.kind === kind)
      .sort((left, right) => numericCompare(left.shortCode, right.shortCode));
    if (members.length === 0) return [];
    const style = LINEAGE_NODE_STYLES[kind];
    return [{
      kind,
      title: STAGE_TITLES[kind] ?? style.label,
      singular: style.label.toLowerCase(),
      plural: style.plural,
      icon: style.icon,
      accent: style.accent,
      accentInk: style.accentInk,
      records: members,
    }];
  });
  const facility =
    geo.facility.lat != null && geo.facility.lng != null
      ? { lat: geo.facility.lat, lng: geo.facility.lng }
      : null;
  const plottable = new Map(resolveLegEndpoints(geo).plottable.map((entry) => [entry.leg.id, entry]));
  return { stages, records, facility, facilityName: geo.facility.name, edges, geo, plottable };
}

// ---------------------------------------------------------------------------
// Legs: one drawn road per place pair
// ---------------------------------------------------------------------------

/** Key for one drawn road: legs of several product layers share it. */
export function drawnPathKey(entry: PlottableLeg): string {
  const { leg, origin, destination } = entry;
  return [leg.kind, origin.lat, origin.lng, destination.lat, destination.lng].join("|");
}

/** A leg as the map draws it: one road, standing for every leg that shares it. */
export interface DrawnLeg {
  entry: PlottableLeg;
  legIds: string[];
  /** Stored one-way km of each grouped leg, by leg id. */
  kmById: Record<string, number>;
}

/** Collapse legs on the same road (one per product layer) into one drawn leg. */
export function groupDrawnLegs(plottable: Iterable<PlottableLeg>): DrawnLeg[] {
  const byPath = new Map<string, DrawnLeg>();
  for (const entry of plottable) {
    const key = drawnPathKey(entry);
    const drawn = byPath.get(key);
    if (drawn) {
      drawn.legIds.push(entry.leg.id);
      drawn.kmById[entry.leg.id] = entry.leg.distanceKm;
    } else {
      byPath.set(key, { entry, legIds: [entry.leg.id], kmById: { [entry.leg.id]: entry.leg.distanceKm } });
    }
  }
  return [...byPath.values()];
}

/**
 * The km a drawn road carries while lit: the stored distance of the grouped
 * legs that are lit, each distinct value once (product layers repeat it), so a
 * selection that lights only one of several legs on a road shows only its km.
 */
export function litKm(drawn: DrawnLeg, litLegIds: ReadonlySet<string>): number {
  const distinct = new Set(drawn.legIds.filter((id) => litLegIds.has(id)).map((id) => drawn.kmById[id]!));
  return Math.round([...distinct].reduce((sum, km) => sum + km, 0) * KM_ROUNDING) / KM_ROUNDING;
}

/** Key of a stored distance: the same road with the same km counts once. */
function distanceKey(model: TraceModel, leg: ChainGeoLeg): string {
  const entry = model.plottable.get(leg.id);
  return `${entry ? drawnPathKey(entry) : leg.id}|${leg.distanceKm}`;
}

/** Legs whose record side sits in `nodeIds`. */
export function legsAnchoredIn(model: TraceModel, nodeIds: Set<string>): ChainGeoLeg[] {
  return model.geo.legs.filter((leg) => nodeIds.has(legAnchorNodeId(model.geo, leg)));
}

/** Total stored one-way km, each road with the same km counted once. */
export function uniqueLegKm(model: TraceModel, legs: ChainGeoLeg[]): number {
  const seen = new Map<string, number>();
  for (const leg of legs) seen.set(distanceKey(model, leg), leg.distanceKm);
  return Math.round([...seen.values()].reduce((sum, km) => sum + km, 0) * KM_ROUNDING) / KM_ROUNDING;
}

/** Both ends of the given legs, as drawn. */
export function legPoints(model: TraceModel, legs: ChainGeoLeg[]): GeoPoint[] {
  return legs.flatMap((leg) => {
    const entry = model.plottable.get(leg.id);
    return entry ? [entry.origin, entry.destination] : [];
  });
}

export function recordPoints(model: TraceModel, nodeIds: Iterable<string>): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (const id of nodeIds) {
    const position = model.records.get(id)?.position;
    if (position) points.push(position);
  }
  return points;
}

/** The downstream records of a set (a delivery's applications, for its legs). */
function downstreamOf(model: TraceModel, nodeIds: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const id of nodeIds) {
    const origin = model.records.get(id);
    if (!origin) continue;
    const reach = reachableNodeIds(id, model.edges);
    for (const other of reach ?? []) {
      const record = model.records.get(other);
      if (record && STAGE_KINDS.indexOf(record.kind) >= STAGE_KINDS.indexOf(origin.kind)) {
        result.add(other);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

/** Nothing selected: the whole batch, framed. */
export function restingLighting(model: TraceModel): MapLighting {
  const points = [
    ...legPoints(model, model.geo.legs),
    ...recordPoints(model, model.records.keys()),
    ...(model.facility ? [model.facility] : []),
  ];
  return { nodeIds: null, legIds: new Set(), points, facilityLit: false, currentNodeId: null };
}

/**
 * A stage: its own records lit, the legs they own lit, the camera on them.
 * Stages that happen at the facility light the facility and frame it close.
 */
export function stageLighting(model: TraceModel, stage: TraceStage): MapLighting {
  const ids = new Set(stage.records.map((record) => record.id));
  // A delivery owns the outbound legs to the fields it supplied.
  const legOwners = stage.kind === "delivery" ? downstreamOf(model, ids) : ids;
  const legs = legsAnchoredIn(model, legOwners);
  const points = [...legPoints(model, legs), ...recordPoints(model, ids)];
  const atFacility = points.length === 0;
  const nodeIds = new Set([...ids, ...(stage.kind === "delivery" ? legOwners : [])]);
  return {
    nodeIds,
    legIds: new Set(legs.map((leg) => leg.id)),
    points: atFacility && model.facility ? [model.facility] : points,
    facilityLit: atFacility || stage.kind === "feedstock" || stage.kind === "delivery",
    currentNodeId: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers for the panels
// ---------------------------------------------------------------------------

/** "Wet: 350 kg · Dry: 315 kg" → the two figures, wet first. Null when the row is not a pair. */
export function splitWetDry(value: string): { wet: string; dry: string } | null {
  const match = /^Wet: (.+) · Dry: (.+)$/.exec(value);
  return match ? { wet: match[1]!, dry: match[2]! } : null;
}

/** The legs a record owns directly (inbound for a feedstock, outbound for a field), each road once. */
export function recordLegs(model: TraceModel, recordId: string): ChainGeoLeg[] {
  const owners = model.records.get(recordId)?.kind === "delivery"
    ? downstreamOf(model, [recordId])
    : new Set([recordId]);
  const seen = new Set<string>();
  return legsAnchoredIn(model, owners).filter((leg) => {
    const key = distanceKey(model, leg);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Kinds whose records happen at the facility: no position of their own is expected. */
const FACILITY_KINDS: readonly LineageNodeKind[] = ["productionRun", "biocharProduct", "order"];

/** Where a record with no position of its own is: at the facility, or nowhere recorded. */
export function placeWithoutPosition(model: TraceModel, kind: LineageNodeKind): string {
  return FACILITY_KINDS.includes(kind) ? `At the facility, ${model.facilityName}` : "No location recorded";
}
