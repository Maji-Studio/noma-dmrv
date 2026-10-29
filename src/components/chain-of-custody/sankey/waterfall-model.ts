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
import { computeClampedDryMass } from "@/lib/calculations/mass-dry";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import {
  EXIT_EPSILON_KG,
  type CreditBatchSankeyData,
  type SankeyColumnKey,
  type SankeyExitKey,
} from "@/lib/chain-of-custody/sankey";
import type { LineageNodeKind } from "../chain-constants";

const EPSILON_KG = EXIT_EPSILON_KG;

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
  /** Short line on the row: why there is no figure, or that it is out of balance. */
  note?: string;
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
  /** Start column only: some run has no dry input, so the figure is a partial sum, not a measurement. */
  figureMissing?: boolean;
}

export type DryStartReason = "wet-missing" | "dry-input-missing" | "wet-below-dry";

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
  /** Why the chart starts dry; null when it starts wet. */
  dryStartReason: DryStartReason | null;
  /** False when the steps cannot close on the applied column: columns then stand on their own. */
  balanced: boolean;
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

interface RowWords {
  /** On a row whose figure cannot be derived. */
  missing: string;
  /** On a row whose figure is negative. */
  negative: string;
  /** In the warnings: the condition, then what to check. */
  warning: (code: string) => string;
}

const ROW_WORDS: Record<"water_driven_off" | "conversion_loss" | "unallocated_output" | "in_storage", RowWords> = {
  water_driven_off: {
    missing: "Needs wet and dry feedstock",
    negative: "Less wet than dry",
    warning: (code) => `${code} records less wet feedstock than dry feedstock. Check its draws and dry input.`,
  },
  conversion_loss: {
    missing: "Needs dry input and output",
    negative: "More out than in",
    warning: (code) => `${code} records more biochar out than feedstock in. Check its dry masses.`,
  },
  unallocated_output: {
    missing: "Needs a product allocation",
    negative: "More in products than made",
    warning: (code) => `${code} has more biochar in products than the run made. Check its allocations.`,
  },
  in_storage: {
    missing: "Needs the product's mass",
    negative: "More applied than made",
    warning: (code) => `${code} has more biochar applied than its recorded mass. Check the product and its applications.`,
  },
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

/** Runs, feedstocks, products and applications behind the lineages, deduped. */
function collect(lineages: readonly WaterfallLineage[]) {
  const runs = new Map<string, RunFacts>();
  const runAllocations = new Map<string, (number | null)[]>();
  const feedstocks = new Map<string, WaterfallRecord>();
  const products = new Map<
    string,
    { record: WaterfallRecord; appliedKg: number; allocatedKg: number | null; lotKg: number | null }
  >();
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
            massKg: null,
            wetKg: sumOrNull([existing ? existing.wetKg : 0, feedstock.wetMassUsedKg]),
          });
        }
      }
    }
    const product = lineage.biocharProduct;
    if (product) {
      const entry = products.get(product.id) ?? {
        record: { id: product.id, kind: "biocharProduct" as const, code: product.code, name: product.formulationName, massKg: null },
        appliedKg: 0,
        allocatedKg: null as number | null,
        lotKg: computeClampedDryMass(product.massKg, product.moistureContentPercent) ?? product.massKg ?? null,
      };
      entry.appliedKg += dryKg;
      // Same precedence as the lib: the allocated dry mass, else the lot's dry mass.
      if (lineage.sources?.every((source) => source.allocatedDryMassKg != null)) {
        entry.allocatedKg =
          (entry.allocatedKg ?? 0) + lineage.sources.reduce((sum, source) => sum + (source.allocatedDryMassKg ?? 0), 0);
      }
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
  // The lib counts a run with no recorded dry input as 0, so wet less dry
  // would invent water: only start wet when every run's dry input is known.
  const dryInputKnown = facts.runs.length > 0 && facts.runs.every((run) => run.dryInKg != null);
  const waterKg = wetFeedstockKg == null || !dryInputKnown ? null : wetFeedstockKg - dryFeedstockKg;
  const wetBelowDry = waterKg != null && waterKg < -EPSILON_KG;
  const startsWet = waterKg != null && !wetBelowDry;
  const startBasis = startsWet ? "wet" : "dry";
  const dryStartReason: DryStartReason | null = startsWet
    ? null
    : !dryInputKnown
      ? "dry-input-missing"
      : wetFeedstockKg == null
        ? "wet-missing"
        : "wet-below-dry";
  const hasWater = startsWet && waterKg != null && waterKg > EPSILON_KG;
  const startKg = startsWet ? (wetFeedstockKg ?? dryFeedstockKg) : dryFeedstockKg;

  const runRecord = (run: RunFacts, massKg: number | null): WaterfallRecord => ({
    id: run.id, kind: "productionRun", code: run.code, name: null, massKg,
  });
  const warnings = [...sankey.warnings];
  if (wetBelowDry) {
    warnings.push("The wet feedstock recorded is below the dry feedstock the runs recorded. Check the draws and the runs' dry inputs.");
  }
  // Each record keeps its own signed figure: the lib clamps only the total,
  // so a negative one is shown as it is and named in the warnings. A figure
  // that cannot be derived says what is missing instead of "Not recorded".
  const withNote = (record: WaterfallRecord, massKg: number | null, words: RowWords): WaterfallRecord => {
    if (massKg == null) return { ...record, massKg, note: words.missing };
    if (massKg < -EPSILON_KG) {
      warnings.push(words.warning(record.code));
      return { ...record, massKg, note: words.negative };
    }
    // Below the threshold it is rounding noise, not a negative figure.
    return { ...record, massKg: Math.max(0, massKg) };
  };
  const runRecords = (figure: (run: RunFacts) => number | null, words: RowWords) =>
    facts.runs.map((run) => withNote(runRecord(run, null), figure(run), words)).sort(byCode);
  const productRecords = facts.products
    .map(({ record, appliedKg, allocatedKg, lotKg }) => {
      const stored = allocatedKg ?? lotKg;
      return withNote(record, stored == null ? null : stored - appliedKg, ROW_WORDS.in_storage);
    })
    .sort(byCode);

  const items: WaterfallItem[] = [];
  let level = startKg;
  items.push({
    key: "feedstock", kind: "start", label: "Feedstock in", massKg: startKg, top: startKg, bottom: 0,
    basis: startBasis, stage: null, recordKind: "feedstock",
    records: [...facts.feedstocks].sort(byCode),
    note: NOTES.feedstock,
    figureMissing: !dryInputKnown,
  });
  const pushStep = (key: WaterfallItemKey, label: string, massKg: number, stage: WaterfallStage, recordKind: LineageNodeKind, records: WaterfallRecord[]) => {
    items.push({ key, kind: "step", label, massKg, top: level, bottom: level - massKg, basis: "dry", stage, recordKind, records, note: NOTES[key] });
    level -= massKg;
  };
  if (hasWater && waterKg != null) {
    pushStep("water_driven_off", "Water driven off", waterKg, "productionRuns", "productionRun",
      runRecords((run) => run.wetInKg == null || run.dryInKg == null ? null : run.wetInKg - run.dryInKg,
        ROW_WORDS.water_driven_off));
  }
  for (const exit of sankey.exits) {
    const stage = STAGE_OF_COLUMN[exit.fromColumn] ?? "productionRuns";
    if (exit.key === "conversion_loss") {
      pushStep(exit.key, exit.label, exit.massKg, stage, "productionRun",
        runRecords((run) => run.dryInKg == null || run.dryOutKg == null ? null : run.dryInKg - run.dryOutKg,
        ROW_WORDS.conversion_loss));
    } else if (exit.key === "unallocated_output") {
      pushStep(exit.key, exit.label, exit.massKg, stage, "productionRun",
        runRecords((run) => run.dryOutKg == null || run.allocatedKg == null ? null : run.dryOutKg - run.allocatedKg,
        ROW_WORDS.unallocated_output));
    } else {
      pushStep(exit.key, exit.label, exit.massKg, stage, "biocharProduct", productRecords);
    }
  }
  const endKg = column("applied");
  items.push({
    key: "applied", kind: "end", label: "Applied", massKg: endKg, top: endKg, bottom: 0, basis: "dry",
    stage: null, recordKind: "application", records: [...facts.applications].sort(byCode), note: NOTES.applied,
  });

  // Hidden residuals still leave the flow; their sum can exceed one tolerance.
  const omittedWaterKg = startsWet && !hasWater ? Math.max(0, waterKg ?? 0) : 0;
  const closingLevel = level - sankey.omittedResidualKg - omittedWaterKg;
  // A floating step would invent a level when the records cannot close.
  const balanced = closingLevel >= -EPSILON_KG && Math.abs(closingLevel - endKg) <= EPSILON_KG;
  if (!balanced) {
    for (const item of items) {
      if (item.kind === "step") {
        item.top = item.massKg;
        item.bottom = 0;
      }
    }
  }

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
    dryStartReason,
    balanced,
    appliedWetKg: sumOrNull(facts.applications.map((record) => record.wetKg)),
    removedKg: steps.reduce((sum, item) => sum + item.massKg, 0),
    stepCount: steps.length,
    warnings,
  };
}

/** Top of the plot: the highest level any column reaches, so none draws off the chart. */
export function chartMaxKg(model: Pick<WaterfallModel, "items" | "startKg">): number {
  return Math.max(model.startKg, ...model.items.map((item) => Math.max(item.top, item.bottom)), 0);
}

/** Level carried from a column to the next one: a step's bottom, else its top. */
export function levelAfter(item: WaterfallItem): number {
  return item.kind === "step" ? item.bottom : item.top;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export function countWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}
