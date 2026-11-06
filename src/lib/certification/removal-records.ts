/**
 * The records behind a Removal, grouped by credit batch (#1554): production
 * runs, applications, deliveries and feedstock deliveries, each as a date, a
 * place and a mass. Pure projection of a credit batch's chain of custody, so
 * the sheet and its tests share one reading of "what is in this batch".
 */
import type { CreditBatchChainData } from "@/data-access/chain-of-custody-batch";

const KG_PER_TONNE = 1000;

export type RemovalRecordKind = "productionRun" | "application" | "delivery" | "feedstock";

export interface RemovalRecord {
  id: string;
  code: string;
  kind: RemovalRecordKind;
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  /** Reactor, field, supplier. Null when the record names none. */
  place: string | null;
  massKg: number | null;
  /** Which mass `massKg` is: biochar is counted dry, a delivery or feedstock intake wet when only that is recorded. */
  basis: "dry" | "wet";
}

export interface RemovalBatchRecords {
  creditBatchId: string;
  code: string;
  startDate: string;
  endDate: string;
  productionRuns: RemovalRecord[];
  applications: RemovalRecord[];
  deliveries: RemovalRecord[];
  feedstock: RemovalRecord[];
}

function day(value: Date | string | null | undefined): string {
  if (!value) return "";
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

function byDate(a: RemovalRecord, b: RemovalRecord): number {
  return a.date.localeCompare(b.date) || a.code.localeCompare(b.code);
}

function unique(records: RemovalRecord[]): RemovalRecord[] {
  return [...new Map(records.map((record) => [record.id, record])).values()].sort(byDate);
}

export function projectBatchRecords(chain: CreditBatchChainData): RemovalBatchRecords {
  const productionRuns: RemovalRecord[] = [];
  const feedstock: RemovalRecord[] = [];
  for (const { source } of chain.rollForwards) {
    const run = source.productionRun;
    productionRuns.push({
      id: run.id,
      code: run.code,
      kind: "productionRun",
      date: day(run.date),
      place: source.reactor?.identifier ?? run.biocharStorageName ?? null,
      massKg: run.biocharDryMassKg,
      basis: "dry",
    });
    for (const intake of source.feedstocks) {
      const wet = intake.wetMassUsedKg;
      feedstock.push({
        id: intake.id,
        code: intake.code,
        kind: "feedstock",
        date: day(intake.deliveryDate),
        place: intake.supplierName,
        massKg: wet ?? intake.massDryKg,
        basis: wet != null ? "wet" : "dry",
      });
    }
  }
  const applications: RemovalRecord[] = [];
  const deliveries: RemovalRecord[] = [];
  for (const { chain: lineage } of chain.lineages) {
    const { application, delivery } = lineage;
    applications.push({
      id: application.id,
      code: application.code,
      kind: "application",
      date: day(application.applicationDate),
      place: application.fieldIdentifier,
      massKg: application.biocharAppliedDryTons == null ? null : application.biocharAppliedDryTons * KG_PER_TONNE,
      basis: "dry",
    });
    deliveries.push({
      id: delivery.id,
      code: delivery.code,
      kind: "delivery",
      date: day(delivery.deliveryDate),
      place: application.fieldIdentifier,
      massKg: delivery.massDryKg ?? delivery.deliveredWetMassKg ?? null,
      basis: delivery.massDryKg != null ? "dry" : "wet",
    });
  }
  return {
    creditBatchId: chain.batch.id,
    code: chain.batch.code,
    startDate: chain.batch.startDate,
    endDate: chain.batch.endDate,
    productionRuns: unique(productionRuns),
    applications: unique(applications),
    deliveries: unique(deliveries),
    feedstock: unique(feedstock),
  };
}
