/**
 * Test fixtures for the Traceability Map model: two feedstocks into one run,
 * one product, one delivery, two applications. The first application has a
 * second outbound leg on the same road (a second product layer).
 */
import type { Edge, Node } from "@xyflow/react";
import type {
  ChainGeoLeg,
  ChainGeoNode,
  ChainGeoNodeKind,
  ChainOfCustodyGeoData,
} from "@/data-access/chain-of-custody-geo";
import { LINEAGE_NODE_STYLES, type LineageNodeKind } from "../chain-constants";
import { buildTraceModel, type TraceModel } from "./trace-model";

export const FACILITY = { lat: -6.163, lng: 35.7516 };
export const SUPPLIER_ONE = { lat: -6.5, lng: 36.1 };
export const SUPPLIER_TWO = { lat: -6.9, lng: 36.6 };
export const FIELD_ONE = { lat: -6.75, lng: 39.2 };
export const FIELD_TWO = { lat: -7.1, lng: 38.4 };
export const FACILITY_ID = "fac-1";

export function recordNode(kind: LineageNodeKind, id: string, shortCode: string): Node {
  const style = LINEAGE_NODE_STYLES[kind];
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      kind,
      label: style.label,
      code: shortCode,
      shortCode,
      icon: style.icon,
      accent: style.accent,
      accentInk: style.accentInk,
      href: null,
      date: null,
      details: [],
    },
  };
}

export const edge = (source: string, target: string): Edge => ({ id: `${source}>${target}`, source, target });

export function geoNode(kind: ChainGeoNodeKind, id: string, code: string, at: { lat: number; lng: number } | null): ChainGeoNode {
  return {
    id,
    kind,
    entityId: id.slice(id.indexOf(":") + 1),
    code,
    lat: at?.lat ?? null,
    lng: at?.lng ?? null,
    positionSource: at ? "own" : "facility",
    inheritedFromFacility: !at,
    sub: null,
  };
}

export function geoLeg(
  id: string,
  kind: "inbound" | "outbound",
  outerNodeId: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  distanceKm: number,
): ChainGeoLeg {
  return {
    id,
    kind,
    entityType: kind === "inbound" ? "feedstock" : "biochar",
    entityId: outerNodeId.slice(outerNodeId.indexOf(":") + 1),
    originName: null,
    originLat: from.lat,
    originLng: from.lng,
    destinationName: null,
    destinationLat: to.lat,
    destinationLng: to.lng,
    distanceKm,
    distanceSource: null,
    isDerived: false,
    loadMassKg: null,
    appliedWetMassKg: null,
    materialLabel: null,
    outerHref: null,
    outerCode: null,
    outerNodeId,
  };
}

export const BATCH_NODES: Node[] = [
  recordNode("feedstock", "feedstock:fs1", "FS-26-001"),
  recordNode("feedstock", "feedstock:fs2", "FS-26-002"),
  recordNode("productionRun", "production-run:pr1", "PR-26-001"),
  recordNode("biocharProduct", "biochar-product:bp1", "BP-26-001"),
  recordNode("delivery", "delivery:dl1", "DL-26-001"),
  recordNode("application", "application:ap1", "Field A"),
  recordNode("application", "application:ap2", "Field B"),
];

export const BATCH_EDGES: Edge[] = [
  edge("feedstock:fs1", "production-run:pr1"),
  edge("feedstock:fs2", "production-run:pr1"),
  edge("production-run:pr1", "biochar-product:bp1"),
  edge("biochar-product:bp1", "delivery:dl1"),
  edge("delivery:dl1", "application:ap1"),
  edge("delivery:dl1", "application:ap2"),
];

export function batchGeo(overrides: Partial<ChainOfCustodyGeoData> = {}): ChainOfCustodyGeoData {
  return {
    facility: { id: FACILITY_ID, code: "FAC-1", name: "Mafinga", ...FACILITY },
    nodes: [
      geoNode("feedstock", "feedstock:fs1", "FS-26-001", SUPPLIER_ONE),
      geoNode("feedstock", "feedstock:fs2", "FS-26-002", SUPPLIER_TWO),
      geoNode("productionRun", "production-run:pr1", "PR-26-001", null),
      geoNode("biocharProduct", "biochar-product:bp1", "BP-26-001", null),
      geoNode("delivery", "delivery:dl1", "DL-26-001", null),
      geoNode("application", "application:ap1", "AP-26-001", FIELD_ONE),
      geoNode("application", "application:ap2", "AP-26-002", FIELD_TWO),
    ],
    legs: [
      geoLeg("in-1", "inbound", "feedstock:fs1", SUPPLIER_ONE, FACILITY, 30),
      geoLeg("in-2", "inbound", "feedstock:fs2", SUPPLIER_TWO, FACILITY, 60),
      geoLeg("out-1", "outbound", "application:ap1", FACILITY, FIELD_ONE, 420),
      geoLeg("out-1-layer-2", "outbound", "application:ap1", FACILITY, FIELD_ONE, 420),
      geoLeg("out-2", "outbound", "application:ap2", FACILITY, FIELD_TWO, 380),
    ],
    warnings: [],
    ...overrides,
  };
}

export function batchModel(overrides: Partial<ChainOfCustodyGeoData> = {}): TraceModel {
  return buildTraceModel(BATCH_NODES, BATCH_EDGES, batchGeo(overrides));
}
