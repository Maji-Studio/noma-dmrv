import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { appliedBiocharFraction, type RemovalRunSummary } from "@/lib/certification/mass-accounting";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import {
  aggregateProductionRuns,
  enrichWithTransportLegs,
  type ProductionRunWithSamples,
  type TransportLegsByCategory,
} from "@/lib/isometric";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import {
  includesProductionInputs,
  productionClaimContribution,
} from "./production-claim-policy";

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
  inputsUnavailable: boolean;
  claims: RemovalLedgerClaim[];
  creditBatches: Array<{ id: string; code: string }>;
  productionRuns: Array<{ id: string; code: string | null }>;
  applications: Array<{
    id: string;
    code: string;
    deliveryCode: string;
    creditBatchIds: string[];
  }>;
}

interface MemberBatchClaim {
  creditBatchId: string;
  code: string;
  claimedByRemovalId: string | null;
  productionRunIds: string[];
  applicationIds: string[];
  applicationSlices?: Array<{ applicationId: string }>;
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
    contribution: productionClaimContribution(
      batch.claimedByRemovalId,
      args.removalId,
    ),
  }));
  const productionRunIds = new Set(
    args.memberBatchClaims
      .filter((batch) =>
        includesProductionInputs(batch.claimedByRemovalId, args.removalId),
      )
      .flatMap((batch) => batch.productionRunIds),
  );
  const inputs: RemovalLedgerInput[] = [];
  let inputsUnavailable = args.runs.length === 0;

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
          kgToTonnes(aggregate.totalBiocharDryMassKg),
          "t",
        ),
      );
      if (productionRunIds.size > 0) {
        inputs.push(
          input(
            "feedstock-dry-mass",
            "Production",
            "Feedstock, dry mass",
            kgToTonnes(aggregate.totalFeedstockDryMassKg),
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
  } catch (error) {
    // Transparency must remain available while incomplete source data blocks
    // numeric aggregation; claim and source links below are still useful.
    inputs.length = 0;
    inputsUnavailable = true;
    logger.warn(
      {
        removalId: args.removalId,
        errorMessage: sanitizeErrorMessage(error),
      },
      "Removal ledger inputs could not be aggregated",
    );
  }

  return {
    inputs,
    inputsUnavailable,
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
            creditBatchIds: args.memberBatchClaims
              .filter((batch) => {
                const applicationIds = batch.applicationSlices?.map(
                  (slice) => slice.applicationId,
                ) ?? batch.applicationIds;
                return applicationIds.includes(lineage.application.id);
              })
              .map((batch) => batch.creditBatchId),
          },
        ]),
      ).values(),
    ],
  };
}
