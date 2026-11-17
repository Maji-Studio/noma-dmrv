import { sourceBiocharMassFlowKg } from "@/lib/biochar-product-mass";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { resolveChainSources } from "./sources";

// Only the fields the aggregation reads, structurally satisfied by
// `ChainOfCustodyData` at the call site.
export interface MassBalanceLineage {
  application: {
    id: string;
    code?: string;
    fieldIdentifier?: string | null;
    biocharAppliedDryTons: number | null;
    biocharAppliedTons?: number | null;
  };
  productionRun: {
    id: string;
    code?: string;
    feedstockMassDryKg: number | null;
    biocharDryMassKg: number | null;
  } | null;
  biocharProduct: {
    id: string;
    code?: string;
    formulationName?: string | null;
    massKg: number | null;
    moistureContentPercent: number | null;
    composition?: unknown;
  } | null;
  feedstocks: {
    id: string;
    code?: string;
    feedstockTypeName?: string | null;
    /** Wet feedstock drawn into a run. Never substituted for dry input. */
    wetMassUsedKg: number | null;
  }[];
  /** Multi-run product provenance; absent on legacy one-run payloads. */
  sources?: {
    productionRun: NonNullable<MassBalanceLineage["productionRun"]>;
    feedstocks: MassBalanceLineage["feedstocks"];
    allocatedDryMassKg?: number | null;
  }[];
}

export interface LineageRunFacts {
  id: string;
  code: string;
  dryInKg: number | null;
  dryOutKg: number | null;
  wetInKg: number | null;
  allocatedKg: number | null;
}

interface RecordFacts {
  id: string;
  code: string;
  name: string | null;
}

interface ProductFacts extends RecordFacts {
  appliedKg: number;
  allocatedKg: number | null;
  /** Resolved from the first record for the waterfall's product row. */
  rowStoredKg: number | null;
  /** Resolved from the last record for the aggregate column. */
  columnMassKg: number;
}

export interface LineageFacts {
  runs: LineageRunFacts[];
  feedstocks: (RecordFacts & { wetKg: number | null })[];
  products: ProductFacts[];
  applications: (RecordFacts & { massKg: number | null; wetKg: number | null })[];
  feedstockCount: number;
  hasProductAllocations: boolean;
  feedstockInKg: number;
  runOutputKg: number;
  lotMassKg: number;
  appliedKg: number;
}

/** A missing contribution makes the whole record's figure unknown. */
export function sumOrNull(values: (number | null | undefined)[]): number | null {
  if (values.length === 0 || values.some((value) => value == null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

/** Extract raw masses in one lineage walk; presentation and verdicts stay with consumers. */
export function extractLineageFacts(lineages: readonly MassBalanceLineage[]): LineageFacts {
  const runs = new Map<string, LineageRunFacts>();
  const latestRuns = new Map<string, NonNullable<MassBalanceLineage["productionRun"]>>();
  const feedstocks = new Map<string, LineageFacts["feedstocks"][number]>();
  const feedstockIds = new Set<string>();
  const applications = new Map<string, LineageFacts["applications"][number]>();
  const products = new Map<string, {
    first: NonNullable<MassBalanceLineage["biocharProduct"]>;
    latest: NonNullable<MassBalanceLineage["biocharProduct"]>;
    appliedKg: number;
    allocatedKg: number | null;
  }>();
  let appliedKg = 0;

  for (const lineage of lineages) {
    const resolvedSources = resolveChainSources(lineage);
    const app = lineage.application;
    const dryKg = tonnesToKg(app.biocharAppliedDryTons ?? 0);
    appliedKg += dryKg;
    const existingApplication = applications.get(app.id);
    // Each lineage is an application/product slice, including repeated applications.
    applications.set(app.id, {
      id: app.id,
      code: app.code ?? "",
      name: app.fieldIdentifier ?? null,
      massKg: sumOrNull([existingApplication ? existingApplication.massKg : 0, app.biocharAppliedDryTons == null ? null : dryKg]),
      wetKg: sumOrNull([
        existingApplication ? existingApplication.wetKg : 0,
        app.biocharAppliedTons == null ? null : tonnesToKg(app.biocharAppliedTons),
      ]),
    });

    for (const source of resolvedSources) {
      const run = source.productionRun;
      latestRuns.set(run.id, run);
      for (const feedstock of source.feedstocks) feedstockIds.add(feedstock.id);
      const existingRun = runs.get(run.id);
      const allocatedKg = source.allocatedDryMassKg ?? null;
      if (existingRun) {
        existingRun.allocatedKg = sumOrNull([existingRun.allocatedKg, allocatedKg]);
        continue;
      }
      runs.set(run.id, {
        id: run.id,
        code: run.code ?? "",
        dryInKg: run.feedstockMassDryKg,
        dryOutKg: run.biocharDryMassKg,
        wetInKg: sumOrNull(source.feedstocks.map((feedstock) => feedstock.wetMassUsedKg)),
        allocatedKg,
      });
      // Rows count a run's draws only on its first appearance. Column counts
      // above retain all distinct feedstocks, as the original Sankey did.
      for (const feedstock of source.feedstocks) {
        const existing = feedstocks.get(feedstock.id);
        feedstocks.set(feedstock.id, {
          id: feedstock.id,
          code: feedstock.code ?? "",
          name: feedstock.feedstockTypeName ?? null,
          wetKg: sumOrNull([existing ? existing.wetKg : 0, feedstock.wetMassUsedKg]),
        });
      }
    }

    const product = lineage.biocharProduct;
    if (product) {
      const entry = products.get(product.id) ?? { first: product, latest: product, appliedKg: 0, allocatedKg: null };
      entry.latest = product;
      entry.appliedKg += dryKg;
      // Preserve the distinction between absent and explicitly empty sources:
      // every([]) supplies a known zero allocation; legacy fallback does not.
      if (lineage.sources?.every((source) => source.allocatedDryMassKg != null)) {
        entry.allocatedKg = (entry.allocatedKg ?? 0)
          + lineage.sources.reduce((sum, source) => sum + (source.allocatedDryMassKg ?? 0), 0);
      }
      products.set(product.id, entry);
    }
  }

  let feedstockInKg = 0;
  let runOutputKg = 0;
  for (const run of latestRuns.values()) {
    feedstockInKg += run.feedstockMassDryKg ?? 0;
    runOutputKg += run.biocharDryMassKg ?? 0;
  }
  let lotMassKg = 0;
  const resolvedProducts: ProductFacts[] = [];
  for (const { first, latest, appliedKg: productAppliedKg, allocatedKg } of products.values()) {
    const mass = (product: typeof first) => sourceBiocharMassFlowKg({
      ...product,
      composition: product.composition,
      sourceAllocatedDryMassKg: allocatedKg,
    });
    const massKg = mass(latest);
    lotMassKg += massKg;
    resolvedProducts.push({
      id: first.id,
      code: first.code ?? "",
      name: first.formulationName ?? null,
      appliedKg: productAppliedKg,
      allocatedKg,
      rowStoredKg: first.massKg == null && allocatedKg == null ? null : mass(first),
      columnMassKg: massKg,
    });
  }
  return {
    runs: [...runs.values()],
    feedstocks: [...feedstocks.values()],
    products: resolvedProducts,
    applications: [...applications.values()],
    feedstockCount: feedstockIds.size,
    hasProductAllocations: resolvedProducts.some((product) => product.allocatedKg != null),
    feedstockInKg,
    runOutputKg,
    lotMassKg,
    appliedKg,
  };
}
