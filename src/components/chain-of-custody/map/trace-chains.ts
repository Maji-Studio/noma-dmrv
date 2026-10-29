/**
 * Pure chains of the batch Traceability Map. A batch is many chains: one path
 * from a supplier to one end (a field, or where the biochar sits while nothing
 * is applied from it yet). The walk steps through one chain record by record;
 * these helpers build the chain and say what each step lights and frames.
 */
import type { LineageNodeKind } from "../chain-constants";
import { legAnchorNodeId } from "./viewer-utils";
import {
  legPoints,
  legsAnchoredIn,
  numericCompare,
  recordPoints,
  stageNoun,
  STAGE_KINDS,
  uniqueLegKm,
  type MapLighting,
  type TraceModel,
  type TraceRecord,
} from "./trace-model";

export interface TraceChain {
  /** The record the chain ends at (an application, or where the biochar is now). */
  end: TraceRecord;
  /** Every record upstream of the end, in chain order, then by code. */
  steps: TraceRecord[];
  /** Legs on this chain. */
  legIds: Set<string>;
  /** Total stored one-way km on its legs, each road once. */
  distanceKm: number;
}

function ancestorsOf(model: TraceModel, nodeId: string): Set<string> {
  const upstream = new Map<string, string[]>();
  for (const edge of model.edges) {
    upstream.set(edge.target, [...(upstream.get(edge.target) ?? []), edge.source]);
  }
  const seen = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of upstream.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** The chain that ends at a record: everything upstream of it, in chain order. */
export function chainTo(model: TraceModel, endId: string): TraceChain | null {
  const end = model.records.get(endId);
  if (!end) return null;
  const upstream = ancestorsOf(model, endId);
  const steps = [...upstream]
    .map((id) => model.records.get(id))
    .filter((record): record is TraceRecord => record != null)
    .sort((left, right) =>
      STAGE_KINDS.indexOf(left.kind) - STAGE_KINDS.indexOf(right.kind) ||
      numericCompare(left.shortCode, right.shortCode),
    );
  const legs = legsAnchoredIn(model, upstream);
  return { end, steps, legIds: new Set(legs.map((leg) => leg.id)), distanceKm: uniqueLegKm(model, legs) };
}

/**
 * Chain ends: records nothing flows out of (fields, or deliveries and bins
 * nothing is applied from yet). Fields first, then by code.
 */
export function buildChains(model: TraceModel): TraceChain[] {
  const hasOutflow = new Set(model.edges.map((edge) => edge.source));
  return [...model.records.values()]
    .filter((record) => !hasOutflow.has(record.id) && record.kind !== "feedstock")
    .flatMap((end) => chainTo(model, end.id) ?? [])
    .sort((left, right) =>
      STAGE_KINDS.indexOf(right.end.kind) - STAGE_KINDS.indexOf(left.end.kind) ||
      numericCompare(left.end.shortCode, right.end.shortCode),
    );
}

/**
 * The chain a picked record starts: the first chain that runs through it
 * (fields first), else the chain that ends at the record itself.
 */
export function chainFor(model: TraceModel, chains: TraceChain[], recordId: string): TraceChain | null {
  return chains.find((chain) => chain.steps.some((step) => step.id === recordId)) ?? chainTo(model, recordId);
}

/**
 * One step of the walk: every record of one stage on this chain. A stage with
 * one record is a plain step; with several (converging intakes, runs or
 * products) the step is titled with the count and lists its records.
 */
export interface ChainStep {
  kind: LineageNodeKind;
  /** The record's kind label for a plain step, "2 production runs" for a group. */
  title: string;
  records: TraceRecord[];
}

/** The chain's records grouped one step per stage kind, in chain order. */
export function chainSteps(chain: TraceChain): ChainStep[] {
  const steps: ChainStep[] = [];
  for (const record of chain.steps) {
    const last = steps[steps.length - 1];
    if (last && last.kind === record.kind) last.records.push(record);
    else steps.push({ kind: record.kind, title: record.label, records: [record] });
  }
  for (const step of steps) {
    if (step.records.length > 1) step.title = `${step.records.length} ${stageNoun(step.kind).plural}`;
  }
  return steps;
}

/** The index of the step that holds a record, or -1. */
export function stepIndexOf(steps: ChainStep[], recordId: string): number {
  return steps.findIndex((step) => step.records.some((record) => record.id === recordId));
}

/** A step of a chain: the chain stays lit, the camera frames every record of the step. */
export function chainStepLighting(
  model: TraceModel,
  chain: TraceChain,
  step: ChainStep,
): MapLighting {
  const chainIds = new Set(chain.steps.map((record) => record.id));
  const stepIds = new Set(step.records.map((record) => record.id));
  const chainLegs = model.geo.legs.filter((leg) => chain.legIds.has(leg.id));
  const stepLegs =
    step.kind === "delivery"
      ? // A delivery spans the outbound legs to the fields it supplied.
        chainLegs.filter((leg) => leg.kind === "outbound")
      : chainLegs.filter((leg) => stepIds.has(legAnchorNodeId(model.geo, leg)));
  let points = [...legPoints(model, stepLegs), ...recordPoints(model, stepIds)];
  if (points.length === 0 && model.facility) points = [model.facility];
  return {
    nodeIds: chainIds,
    legIds: chain.legIds,
    points,
    facilityLit: true,
    currentNodeIds: stepIds,
  };
}
