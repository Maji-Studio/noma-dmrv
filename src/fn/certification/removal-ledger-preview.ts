import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { appliedBiocharFraction, type RemovalRunSummary } from "@/lib/certification/mass-accounting";
import {
  aggregateProductionRuns,
  enrichWithTransportLegs,
  type ProductionRunWithSamples,
  type TransportLegsByCategory,
} from "@/lib/isometric";

export interface RemovalLedgerInput {
  id: string;
  component: string;
  input: string;
  magnitude: number | null;
  unit: string;
}

export interface RemovalLedgerClaim {
  creditBatchId: string;
  creditBatchCode: string;
  claimingRemovalId: string | null;
  contribution: "production-and-delivery" | "delivery-only";
}

export interface RemovalLedgerPreview {
  inputs: RemovalLedgerInput[];
  claims: RemovalLedgerClaim[];
  creditBatches: Array<{ id: string; code: string }>;
  productionRuns: Array<{ id: string; code: string | null }>;
  applications: Array<{
    id: string;
    code: string;
    deliveryCode: string;
  }>;
}

interface MemberBatchClaim {
  creditBatchId: string;
  code: string;
  claimedByRemovalId: string | null;
  productionRunIds: string[];
}

function input(
  id: string,
  component: string,
  label: string,
  magnitude: number | null,
  unit: string,
): RemovalLedgerInput {
  return { id, component, input: label, magnitude, unit };
}

export function buildRemovalLedgerPreview(args: {
  removalId: string | null;
  memberBatchClaims: MemberBatchClaim[];
  runs: ProductionRunWithSamples[];
  lineages: ChainOfCustodyData[];
  transportLegs: TransportLegsByCategory;
  attributionByRunId: Map<string, number>;
  runSummary: RemovalRunSummary;
  requiredTransportCategories: readonly ("feedstock" | "biochar" | "sample")[];
}): RemovalLedgerPreview {
  const claims: RemovalLedgerClaim[] = args.memberBatchClaims.map((batch) => ({
    creditBatchId: batch.creditBatchId,
    creditBatchCode: batch.code,
    claimingRemovalId: batch.claimedByRemovalId,
    contribution:
      batch.claimedByRemovalId == null ||
      batch.claimedByRemovalId === args.removalId
        ? "production-and-delivery"
        : "delivery-only",
  }));
  const productionRunIds = new Set(
    args.memberBatchClaims
      .filter(
        (batch) =>
          batch.claimedByRemovalId == null ||
          batch.claimedByRemovalId === args.removalId,
      )
      .flatMap((batch) => batch.productionRunIds),
  );
  const inputs: RemovalLedgerInput[] = [];

  try {
    if (args.runs.length > 0) {
    const aggregate = enrichWithTransportLegs(
      aggregateProductionRuns(args.runs, args.attributionByRunId, {
        productionRunIds,
      }),
      args.transportLegs,
      { appliedBiocharFraction: appliedBiocharFraction(args.runSummary) },
    );
    inputs.push(
      input(
        "biochar-dry-mass",
        "Stored carbon",
        "Biochar, dry mass",
        aggregate.totalBiocharDryMassKg / 1_000,
        "t",
      ),
    );
    if (productionRunIds.size > 0) {
      inputs.push(
        input(
          "feedstock-dry-mass",
          "Production",
          "Feedstock, dry mass",
          aggregate.totalFeedstockDryMassKg / 1_000,
          "t",
        ),
        input(
          "diesel",
          "Production",
          "Diesel",
          aggregate.totalDieselLitres,
          "L",
        ),
        input(
          "grid-electricity",
          "Production",
          "Grid electricity",
          aggregate.totalElectricityKwh,
          "kWh",
        ),
      );
    }
    if (args.requiredTransportCategories.includes("feedstock")) {
      inputs.push(
        input(
          "feedstock-transport",
          "Feedstock transport",
          "Mass and distance",
          aggregate.feedstockTransportMassDistanceTonneKm,
          "t·km",
        ),
      );
    }
    if (args.requiredTransportCategories.includes("biochar")) {
      inputs.push(
        input(
          "biochar-transport",
          "Biochar delivery",
          "Mass and distance",
          aggregate.biocharTransportMassDistanceTonneKm,
          "t·km",
        ),
      );
    }
    if (
      args.requiredTransportCategories.includes("sample") &&
      aggregate.sampleTransportMassDistanceTonneKm > 0
    ) {
      inputs.push(
        input(
          "sample-transport",
          "Sample transport",
          "Mass and distance",
          aggregate.sampleTransportMassDistanceTonneKm,
          "t·km",
        ),
      );
    }
    }
  } catch {
    // Transparency must remain available while incomplete source data blocks
    // numeric aggregation; claim and source links below are still useful.
    inputs.length = 0;
  }

  return {
    inputs,
    claims,
    creditBatches: args.memberBatchClaims.map((batch) => ({
      id: batch.creditBatchId,
      code: batch.code,
    })),
    productionRuns: args.runs.map((run) => ({ id: run.id, code: run.code })),
    applications: [
      ...new Map(
        args.lineages.map((lineage) => [
          lineage.application.id,
          {
            id: lineage.application.id,
            code: lineage.application.code,
            deliveryCode: lineage.delivery.code,
          },
        ]),
      ).values(),
    ],
  };
}
