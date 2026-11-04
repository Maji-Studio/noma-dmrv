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
  // An application's chain is what it was supplied from; other ends take every ancestor.
  const upstream = model.lineageIds.get(endId) ?? ancestorsOf(model, endId);
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

/** Where a chain walk stands: the chain (by its end), the step, and the record open inside it. */
export interface ChainWalk {
  endId: string;
  /** Index into the chain's steps (one per stage). */
  stepIndex: number;
  /** The record opened in place inside a grouped step; null = none. */
  openRecordId: string | null;
}

/** The walk's chain, steps and current step, or null when its end is not in the model. */
export function resolveWalk(
  model: TraceModel,
  chains: TraceChain[],
  walk: ChainWalk | null,
): { chain: TraceChain; steps: ChainStep[]; stepIndex: number; step: ChainStep } | null {
  if (!walk) return null;
  const chain = chains.find((candidate) => candidate.end.id === walk.endId) ?? chainTo(model, walk.endId);
  if (!chain) return null;
  const steps = chainSteps(chain);
  const stepIndex = Math.max(0, Math.min(walk.stepIndex, steps.length - 1));
  const step = steps[stepIndex];
  return step ? { chain, steps, stepIndex, step } : null;
}

/**
 * Walk to a record (a marker, a list row or a Flow pick). Inside the current
 * chain it moves to the record's step with the record open. Otherwise it
 * starts the first chain through the record: a chain end starts at the
 * supplier, any other record on its own stage's step with that record open.
 * Null when no chain holds the record (the reactor, an unknown id).
 */
export function walkTo(
  model: TraceModel,
  chains: TraceChain[],
  current: ChainWalk | null,
  recordId: string,
): ChainWalk | null {
  const resolved = resolveWalk(model, chains, current);
  const inChain = resolved ? stepIndexOf(resolved.steps, recordId) : -1;
  if (resolved && inChain >= 0) return { endId: resolved.chain.end.id, stepIndex: inChain, openRecordId: recordId };
  const next = chainFor(model, chains, recordId);
  if (!next) return null;
  if (next.end.id === recordId) return { endId: next.end.id, stepIndex: 0, openRecordId: null };
  return { endId: next.end.id, stepIndex: Math.max(0, stepIndexOf(chainSteps(next), recordId)), openRecordId: recordId };
}
