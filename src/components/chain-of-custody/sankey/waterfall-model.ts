/**
 * Pure: turns the
 * batch's mass balance (`buildBatchSankey`) and the loaded lineages into a
 * waterfall in kg. Every figure is the lib's own column or exit, or a sum of
 * masses already on the lineages; nothing is estimated.
 *
 * Start column: the feedstock that went in, wet when every member run's draws
 * carry a wet mass (then "Water driven off" is the first step: wet less the
 * runs' dry feedstock), otherwise dry. Steps: the lib's exits in flow order.
 * End column: the dry biochar applied, lit.
 */
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import type {
  CreditBatchSankeyData,
  SankeyColumnKey,
  SankeyExitKey,
} from "@/lib/chain-of-custody/sankey";
import type { LineageNodeKind } from "../chain-constants";

/** Below this a residual is rounding noise (matches the lib's epsilon). */
const EPSILON_KG = 0.5;

export type WaterfallItemKey =
  | "feedstock"
  | "water_driven_off"
  | SankeyExitKey
  | "applied";
/** The lit last column, selected until another is picked. */
export const DEFAULT_COLUMN: WaterfallItemKey = "applied";
export type WaterfallStage = "productionRuns" | "biocharLots";

export interface WaterfallRecord {
  id: string;
  kind: LineageNodeKind;
  code: string;
  /** One quiet name after the code: feedstock type, field, blend. */
  name: string | null;
  /** This record's part of the column, in kg, on the column's basis. */
  massKg: number | null;
  /** Applications also carry the wet product mass they were weighed at. */
  wetKg?: number | null;
}

export interface WaterfallItem {
  key: WaterfallItemKey;
  kind: "start" | "step" | "end";
  label: string;
  massKg: number;
  /** Level before and after this column, in kg (a step floats between them). */
  top: number;
  bottom: number;
  basis: "wet" | "dry";
  /** Bracket group under the steps; start and end have none. */
  stage: WaterfallStage | null;
  /** The record list behind the column and its "See details" target. */
  recordKind: LineageNodeKind;
  records: WaterfallRecord[];
  note: string;
}

export interface WaterfallGroup {
  stage: WaterfallStage;
  label: string;
  keys: WaterfallItemKey[];
}

export interface WaterfallModel {
  items: WaterfallItem[];
  groups: WaterfallGroup[];
  startKg: number;
  endKg: number;
  /** Basis of the start column. Every later figure is dry. */
  startBasis: "wet" | "dry";
  /** Wet product weighed at the applications (with ingredients and water). */
  appliedWetKg: number | null;
  removedKg: number;
  stepCount: number;
  warnings: string[];
}

const STAGE_LABELS: Record<WaterfallStage, string> = {
  productionRuns: "Production runs",
  biocharLots: "Biochar products",
};

const STAGE_OF_COLUMN: Partial<Record<SankeyColumnKey, WaterfallStage>> = {
  productionRuns: "productionRuns",
  biocharLots: "biocharLots",
};

const NOTES: Record<WaterfallItemKey, string> = {
  feedstock: "Feedstock drawn into the production runs behind these applications.",
  water_driven_off: "Water in the feedstock, driven off in the reactor.",
  conversion_loss: "Pyrolysis gas and heat, which are the expected conversion loss.",
  unallocated_output: "Run output not allocated to any biochar lot in this batch.",
  in_storage: "Biochar produced for this batch but not yet applied.",
  applied: "Dry biochar in the product applied on the fields.",
};

export type WaterfallLineage = Pick<
  ChainOfCustodyData,
  "application" | "biocharProduct" | "productionRun" | "feedstocks" | "sources"
>;

interface RunFacts {
  id: string;
  code: string;
  dryInKg: number | null;
  dryOutKg: number | null;
  wetInKg: number | null;
  allocatedKg: number | null;
}

function sourcesOf(lineage: WaterfallLineage) {
  if (lineage.sources && lineage.sources.length > 0) return lineage.sources;
  return lineage.productionRun
    ? [{ productionRun: lineage.productionRun, feedstocks: lineage.feedstocks, allocatedDryMassKg: null }]
    : [];
}

function sumOrNull(values: (number | null | undefined)[]): number | null {
  if (values.length === 0 || values.some((value) => value == null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function positive(value: number | null): number | null {
  return value == null ? null : Math.max(0, value);
}

/** Runs, feedstocks, products and applications behind the lineages, deduped. */
function collect(lineages: readonly WaterfallLineage[]) {
  const runs = new Map<string, RunFacts>();
  const runAllocations = new Map<string, (number | null)[]>();
  const feedstocks = new Map<string, WaterfallRecord>();
  const products = new Map<string, { record: WaterfallRecord; appliedKg: number }>();
  const applications = new Map<string, WaterfallRecord>();
  for (const lineage of lineages) {
    const app = lineage.application;
    const dryKg = tonnesToKg(app.biocharAppliedDryTons ?? 0);
    // A lineage is one application slice per product, so an application
    // that drew from two products arrives twice: sum its slices.
    const existingApplication = applications.get(app.id);
    applications.set(app.id, {
      id: app.id,
      kind: "application",
      code: app.code,
      name: app.fieldIdentifier ?? null,
      massKg: sumOrNull([existingApplication ? existingApplication.massKg : 0, app.biocharAppliedDryTons == null ? null : dryKg]),
      wetKg: sumOrNull([
        existingApplication ? existingApplication.wetKg : 0,
        app.biocharAppliedTons == null ? null : tonnesToKg(app.biocharAppliedTons),
      ]),
    });
    for (const source of sourcesOf(lineage)) {
      const run = source.productionRun;
      runAllocations.set(run.id, [...(runAllocations.get(run.id) ?? []), source.allocatedDryMassKg ?? null]);
      if (!runs.has(run.id)) {
        runs.set(run.id, {
          id: run.id,
          code: run.code,
          dryInKg: run.feedstockMassDryKg,
          dryOutKg: run.biocharDryMassKg,
          wetInKg: source.feedstocks.length > 0 ? sumOrNull(source.feedstocks.map((feedstock) => feedstock.wetMassUsedKg)) : null,
          allocatedKg: null,
        });
        for (const feedstock of source.feedstocks) {
          const existing = feedstocks.get(feedstock.id);
          feedstocks.set(feedstock.id, {
            id: feedstock.id,
            kind: "feedstock",
            code: feedstock.code,
            name: feedstock.feedstockTypeName,
            massKg: sumOrNull([existing ? existing.massKg : 0, feedstock.wetMassUsedKg]),
          });
        }
      }
    }
    const product = lineage.biocharProduct;
    if (product) {
      const entry = products.get(product.id) ?? {
        record: { id: product.id, kind: "biocharProduct" as const, code: product.code, name: product.formulationName, massKg: null },
        appliedKg: 0,
      };
      entry.appliedKg += dryKg;
      products.set(product.id, entry);
    }
  }
  for (const [runId, allocations] of runAllocations) {
    const run = runs.get(runId);
    if (run) run.allocatedKg = sumOrNull(allocations);
  }
  return { runs: [...runs.values()], feedstocks: [...feedstocks.values()], products: [...products.values()], applications: [...applications.values()] };
}

const byCode = (left: WaterfallRecord, right: WaterfallRecord) =>
  left.code.localeCompare(right.code, undefined, { numeric: true });

export function buildWaterfall(
  sankey: CreditBatchSankeyData,
  lineages: readonly WaterfallLineage[],
): WaterfallModel {
  const facts = collect(lineages);
  const column = (key: SankeyColumnKey) => sankey.columns.find((entry) => entry.key === key)?.massKg ?? 0;
  const dryFeedstockKg = column("feedstock");
  const wetFeedstockKg = sumOrNull(facts.runs.map((run) => run.wetInKg));
  const waterKg = wetFeedstockKg == null ? null : wetFeedstockKg - dryFeedstockKg;
  const hasWater = waterKg != null && waterKg > EPSILON_KG;
  const startBasis = hasWater ? "wet" : "dry";
  const startKg = hasWater ? (wetFeedstockKg ?? dryFeedstockKg) : dryFeedstockKg;

  const runRecord = (run: RunFacts, massKg: number | null): WaterfallRecord => ({
    id: run.id, kind: "productionRun", code: run.code, name: null, massKg,
  });
  const runRecords = (figure: (run: RunFacts) => number | null) =>
    facts.runs.map((run) => runRecord(run, positive(figure(run)))).sort(byCode);
  const productRecords = facts.products
    .map(({ record }) => record)
    .sort(byCode);

  const items: WaterfallItem[] = [];
  let level = startKg;
  items.push({
    key: "feedstock", kind: "start", label: "Feedstock in", massKg: startKg, top: startKg, bottom: 0,
    basis: startBasis, stage: null, recordKind: "feedstock",
    records: [...facts.feedstocks].map((record) => hasWater ? record : { ...record, massKg: null }).sort(byCode),
    note: NOTES.feedstock,
  });
  const pushStep = (key: WaterfallItemKey, label: string, massKg: number, stage: WaterfallStage, recordKind: LineageNodeKind, records: WaterfallRecord[]) => {
    items.push({ key, kind: "step", label, massKg, top: level, bottom: level - massKg, basis: "dry", stage, recordKind, records, note: NOTES[key] });
    level -= massKg;
  };
  if (hasWater && waterKg != null) {
    pushStep("water_driven_off", "Water driven off", waterKg, "productionRuns", "productionRun",
      runRecords((run) => run.wetInKg == null || run.dryInKg == null ? null : run.wetInKg - run.dryInKg));
  }
  for (const exit of sankey.exits) {
    const stage = STAGE_OF_COLUMN[exit.fromColumn] ?? "productionRuns";
    if (exit.key === "conversion_loss") {
      pushStep(exit.key, exit.label, exit.massKg, stage, "productionRun",
        runRecords((run) => run.dryInKg == null || run.dryOutKg == null ? null : run.dryInKg - run.dryOutKg));
    } else if (exit.key === "unallocated_output") {
      pushStep(exit.key, exit.label, exit.massKg, stage, "productionRun",
        runRecords((run) => run.dryOutKg == null || run.allocatedKg == null ? null : run.dryOutKg - run.allocatedKg));
    } else {
      pushStep(exit.key, exit.label, exit.massKg, stage, "biocharProduct", productRecords);
    }
  }
  const endKg = column("applied");
  items.push({
    key: "applied", kind: "end", label: "Applied", massKg: endKg, top: endKg, bottom: 0, basis: "dry",
    stage: null, recordKind: "application", records: [...facts.applications].sort(byCode), note: NOTES.applied,
  });

  const groups: WaterfallGroup[] = [];
  for (const item of items) {
    if (!item.stage) continue;
    const last = groups[groups.length - 1];
    if (last && last.stage === item.stage) last.keys.push(item.key);
    else groups.push({ stage: item.stage, label: STAGE_LABELS[item.stage], keys: [item.key] });
  }

  const steps = items.filter((item) => item.kind === "step");
  return {
    items,
    groups,
    startKg,
    endKg,
    startBasis,
    appliedWetKg: sumOrNull(facts.applications.map((record) => record.wetKg)),
    removedKg: steps.reduce((sum, item) => sum + item.massKg, 0),
    stepCount: steps.length,
    warnings: sankey.warnings,
  };
}

/** Level carried from a column to the next one: a step's bottom, else its top. */
export function levelAfter(item: WaterfallItem): number {
  return item.kind === "step" ? item.bottom : item.top;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export function countWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}
