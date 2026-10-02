/**
 * Energy Sankey model: groups the period's flows into credit batch nodes and
 * lays out three columns (sources, stages, credit batches) in chart units.
 *
 * Bands are sized by estimated kg CO2e, so the layout only exists when the
 * facility has emission factors. The pixel scale is computed from the
 * unfiltered flows so a batch filter dims bands instead of rescaling them.
 */
import {
  ENERGY_SOURCES,
  ENERGY_SOURCE_BY_KEY,
  ENERGY_STAGES,
  type EnergySourceKey,
  type EnergyStage,
} from "./sources";
import type { EnergyCreditBatchInput, EnergyFlow } from "./types";

/** Batch node for flows that reach no credit batch. */
export const UNASSIGNED_BATCH_KEY = "unassigned";
/** Batch node for the credit batches past the named ones. */
export const OTHER_BATCHES_KEY = "other";
/** Most credit batches named in the chart; past it the rest are grouped. */
export const NAMED_BATCH_LIMIT = 5;

export const SANKEY_CHART = {
  width: 800,
  height: 420,
  barWidth: 12,
  sourceX: 150,
  stageX: 400,
  batchX: 640,
  gap: 8,
  stageGap: 40,
  /** Minimum vertical slot per labelled node so two-line labels never collide. */
  slot: 28,
  minBar: 2,
  /** Head room kept free inside the chart height. */
  padding: 24,
} as const;

const SCALE_STEP = 0.93;
const SCALE_ITERATIONS = 40;

export interface SankeyBatchNode {
  key: string;
  /** Credit batch code, or the grouped count. Unassigned has no code. */
  code: string | null;
  groupedCount: number;
}

export interface SankeyFlow {
  source: EnergySourceKey;
  batchKey: string;
  kg: number;
}

/**
 * Batch nodes for the flows: every batch that received energy, newest first,
 * the five largest named and the rest grouped as "other", plus the unassigned
 * node. A selected batch always keeps its own node, taking the fifth slot when
 * it is not among the five largest.
 */
export function groupSankeyBatches(
  flows: EnergyFlow[],
  creditBatches: EnergyCreditBatchInput[],
  selectedBatchId: string | null,
): { nodes: SankeyBatchNode[]; flows: SankeyFlow[] } {
  const kgByBatch = new Map<string, number>();
  for (const flow of flows) {
    if (flow.creditBatchId && flow.kg) {
      kgByBatch.set(flow.creditBatchId, (kgByBatch.get(flow.creditBatchId) ?? 0) + flow.kg);
    }
  }
  const ranked = creditBatches
    .filter((batch) => (kgByBatch.get(batch.id) ?? 0) > 0)
    .sort((a, b) => (kgByBatch.get(b.id) ?? 0) - (kgByBatch.get(a.id) ?? 0));
  const top = ranked.slice(0, NAMED_BATCH_LIMIT).map((batch) => batch.id);
  if (
    selectedBatchId &&
    !top.includes(selectedBatchId) &&
    ranked.some((batch) => batch.id === selectedBatchId)
  ) {
    top[NAMED_BATCH_LIMIT - 1] = selectedBatchId;
  }
  const named = new Set(top);

  const nodes: SankeyBatchNode[] = ranked
    .filter((batch) => named.has(batch.id))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((batch) => ({ key: batch.id, code: batch.code, groupedCount: 0 }));
  const otherCount = ranked.length - named.size;
  if (otherCount > 0) {
    nodes.push({ key: OTHER_BATCHES_KEY, code: null, groupedCount: otherCount });
  }
  const batchIds = new Set(creditBatches.map((batch) => batch.id));
  const toKey = (id: string | null) =>
    id == null || !batchIds.has(id) ? UNASSIGNED_BATCH_KEY : named.has(id) ? id : OTHER_BATCHES_KEY;
  const mapped = flows
    .filter((flow) => (flow.kg ?? 0) > 0)
    .map((flow) => ({ source: flow.source, batchKey: toKey(flow.creditBatchId), kg: flow.kg ?? 0 }));
  if (mapped.some((flow) => flow.batchKey === UNASSIGNED_BATCH_KEY)) {
    nodes.push({ key: UNASSIGNED_BATCH_KEY, code: null, groupedCount: 0 });
  }
  return { nodes, flows: mapped };
}

export type SankeyColumn = "source" | "stage" | "batch";

export interface SankeyNode {
  id: string;
  column: SankeyColumn;
  kg: number;
  y: number;
  h: number;
  source?: EnergySourceKey;
  stage?: EnergyStage;
  batchKey?: string;
}

export interface SankeyLink {
  id: string;
  source: EnergySourceKey;
  stage: EnergyStage;
  batchKey: string;
  leg: "toStage" | "toBatch";
  kg: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  h: number;
}

export interface SankeyLayout {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

const stageOf = (source: EnergySourceKey) => ENERGY_SOURCE_BY_KEY[source].stage;
const sumKg = (flows: SankeyFlow[], keep: (flow: SankeyFlow) => boolean) =>
  flows.filter(keep).reduce((total, flow) => total + flow.kg, 0);

function columnHeight(kgs: number[], scale: number): number {
  return kgs
    .filter((kg) => kg > 0)
    .reduce(
      (total, kg) =>
        total + Math.max(SANKEY_CHART.minBar, kg * scale, SANKEY_CHART.slot) + SANKEY_CHART.gap,
      -SANKEY_CHART.gap,
    );
}

/** Pixels per kg such that the tallest column, label slots included, fits. */
export function sankeyScale(flows: SankeyFlow[], batchKeys: string[]): number {
  const bySource = ENERGY_SOURCES.map((s) => sumKg(flows, (f) => f.source === s.key));
  const byBatch = batchKeys.map((key) => sumKg(flows, (f) => f.batchKey === key));
  const total = bySource.reduce((a, kg) => a + kg, 0) || 1;
  const room = SANKEY_CHART.height - SANKEY_CHART.padding;
  let scale = room / total;
  for (
    let i = 0;
    i < SCALE_ITERATIONS &&
    Math.max(columnHeight(bySource, scale), columnHeight(byBatch, scale)) > room;
    i++
  ) {
    scale *= SCALE_STEP;
  }
  return scale;
}

function stack(items: { id: string; kg: number }[], gap: number, slot: number, height: (kg: number) => number) {
  let y = 0;
  const top = new Map<string, number>();
  for (const item of items) {
    if (height(item.kg) === 0) continue;
    top.set(item.id, y);
    y += Math.max(height(item.kg), slot) + gap;
  }
  const total = Math.max(0, y - gap);
  const offset = Math.max(0, (SANKEY_CHART.height - total) / 2);
  return new Map([...top].map(([id, value]) => [id, value + offset]));
}

/** Three columns of nodes and the two legs of bands between them. */
export function layoutSankey(
  flows: SankeyFlow[],
  batchKeys: string[],
  scale: number,
): SankeyLayout {
  const height = (kg: number) => (kg > 0 ? Math.max(SANKEY_CHART.minBar, kg * scale) : 0);
  const sourceItems = ENERGY_SOURCES.map((s) => ({ id: s.key, kg: sumKg(flows, (f) => f.source === s.key) }));
  const stageItems = ENERGY_STAGES.map((s) => ({ id: s.key, kg: sumKg(flows, (f) => stageOf(f.source) === s.key) }));
  const batchItems = batchKeys.map((key) => ({ id: key, kg: sumKg(flows, (f) => f.batchKey === key) }));
  const sourceTop = stack(sourceItems, SANKEY_CHART.gap, SANKEY_CHART.slot, height);
  const stageTop = stack(stageItems, SANKEY_CHART.stageGap, 0, height);
  const batchTop = stack(batchItems, SANKEY_CHART.gap, SANKEY_CHART.slot, height);

  const nodes: SankeyNode[] = [];
  for (const item of sourceItems) {
    const y = sourceTop.get(item.id);
    if (y != null) nodes.push({ id: `source-${item.id}`, column: "source", source: item.id as EnergySourceKey, kg: item.kg, y, h: height(item.kg) });
  }
  for (const item of stageItems) {
    const y = stageTop.get(item.id);
    if (y != null) nodes.push({ id: `stage-${item.id}`, column: "stage", stage: item.id as EnergyStage, kg: item.kg, y, h: height(item.kg) });
  }
  for (const item of batchItems) {
    const y = batchTop.get(item.id);
    if (y != null) nodes.push({ id: `batch-${item.id}`, column: "batch", batchKey: item.id, kg: item.kg, y, h: height(item.kg) });
  }

  const pairKg = (source: EnergySourceKey, batchKey: string) =>
    sumKg(flows, (f) => f.source === source && f.batchKey === batchKey);
  const sourceCursor = new Map(sourceTop);
  const stageIn = new Map(stageTop);
  const stageOut = new Map(stageTop);
  const batchIn = new Map(batchTop);
  const links: SankeyLink[] = [];

  // Left leg: each source stacks its bands by batch; stages stack them source first.
  for (const source of ENERGY_SOURCES) {
    for (const batchKey of batchKeys) {
      const kg = pairKg(source.key, batchKey);
      if (kg <= 0) continue;
      const h = height(kg);
      const y0 = sourceCursor.get(source.key) ?? 0;
      const y1 = stageIn.get(source.stage) ?? 0;
      sourceCursor.set(source.key, y0 + h);
      stageIn.set(source.stage, y1 + h);
      links.push({
        id: `${source.key}-${batchKey}-stage`,
        source: source.key,
        stage: source.stage,
        batchKey,
        leg: "toStage",
        kg,
        x0: SANKEY_CHART.sourceX + SANKEY_CHART.barWidth,
        x1: SANKEY_CHART.stageX,
        y0,
        y1,
        h,
      });
    }
  }
  // Right leg: each stage stacks its bands by batch, then source.
  for (const stage of ENERGY_STAGES) {
    for (const batchKey of batchKeys) {
      for (const source of ENERGY_SOURCES.filter((s) => s.stage === stage.key)) {
        const kg = pairKg(source.key, batchKey);
        if (kg <= 0) continue;
        const h = height(kg);
        const y0 = stageOut.get(stage.key) ?? 0;
        const y1 = batchIn.get(batchKey) ?? 0;
        stageOut.set(stage.key, y0 + h);
        batchIn.set(batchKey, y1 + h);
        links.push({
          id: `${source.key}-${batchKey}-batch`,
          source: source.key,
          stage: stage.key,
          batchKey,
          leg: "toBatch",
          kg,
          x0: SANKEY_CHART.stageX + SANKEY_CHART.barWidth,
          x1: SANKEY_CHART.batchX,
          y0,
          y1,
          h,
        });
      }
    }
  }
  return { nodes, links };
}

/** SVG path of a band from its left top edge to its right top edge. */
export function sankeyBandPath(link: SankeyLink): string {
  const mid = (link.x0 + link.x1) / 2;
  return (
    `M${link.x0},${link.y0} C${mid},${link.y0} ${mid},${link.y1} ${link.x1},${link.y1} ` +
    `L${link.x1},${link.y1 + link.h} C${mid},${link.y1 + link.h} ${mid},${link.y0 + link.h} ${link.x0},${link.y0 + link.h} Z`
  );
}
