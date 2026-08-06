import type { getChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { CreditBatchLineageFacts } from "@/data-access/credit-batch-accounting";
import type { DocumentRow } from "@/data-access/documents";
import { APPLICATION_VISUAL_EVIDENCE_ROLES } from "@/lib/certification/application-evidence";

const DEFAULT_FACT_DATE = new Date("2026-01-20T00:00:00Z");

export function satisfiedVisualEvidenceDocuments(
  applicationId: string,
): DocumentRow[] {
  return APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => ({
    entityId: applicationId,
    documentType: "photo",
    uploadStatus: "uploaded",
    fileUrl: null,
    metadata: { geotagStatus: "present", evidenceRole: role },
  })) as unknown as DocumentRow[];
}

export function factsFromMockedLineages(
  batchId: string,
  productionRunIds: string[],
  lineages: Awaited<ReturnType<typeof getChainOfCustodyData>>[],
  // Status per member run id for runs not covered by a lineage. The real
  // membership query returns every member run regardless of status; runs
  // default to "complete" here so lineage-focused tests stay unaffected.
  memberRunStatusById: Record<string, string> = {},
): CreditBatchLineageFacts {
  const resolved = lineages.filter(Boolean);
  const runs = resolved.flatMap((lineage) =>
    lineage.productionRun
      ? [
          {
            id: lineage.productionRun.id,
            code: lineage.productionRun.code ?? "PR-1",
            status: lineage.productionRun.status ?? "complete",
            date: lineage.productionRun.date ?? DEFAULT_FACT_DATE,
            biocharDryMassKg: lineage.productionRun.biocharDryMassKg ?? 100,
            feedstockMassDryKg:
              lineage.productionRun.feedstockMassDryKg ?? 200,
            reactor: lineage.reactor
              ? {
                  id: lineage.reactor.id,
                  code: lineage.reactor.code ?? "R-1",
                  identifier: lineage.reactor.identifier ?? "R-1",
                  reactorType: lineage.reactor.reactorType ?? "fixed-bed",
                }
              : null,
            feedstocks: lineage.feedstocks.map((feedstock, index) => ({
              id: feedstock.id,
              code: feedstock.code ?? `FS-${index + 1}`,
              status: feedstock.status ?? "complete",
              deliveryDate: feedstock.deliveryDate ?? DEFAULT_FACT_DATE,
              massDryKg: feedstock.massDryKg ?? 100,
              massUsedKg: feedstock.massUsedKg ?? 100,
              eligibilityStatus: feedstock.eligibilityStatus ?? "eligible",
              supplierName: feedstock.supplierName ?? "Supplier",
              feedstockTypeName: feedstock.feedstockTypeName ?? "Wood",
              feedstockDeliveryCode: feedstock.feedstockDeliveryCode ?? null,
            })),
          },
        ]
      : [],
  );
  const applications = resolved.map((lineage, index) => {
    const runId =
      lineage.productionRun?.id ?? productionRunIds[index] ?? "pr-1";
    return {
      id: lineage.application.id ?? `app-${index + 1}`,
      code: lineage.application.code ?? `APP-${index + 1}`,
      status: lineage.application.status ?? "complete",
      applicationDate:
        lineage.application.applicationDate ?? DEFAULT_FACT_DATE,
      fieldIdentifier: lineage.application.fieldIdentifier ?? null,
      evidenceMethod: lineage.application.evidenceMethod,
      gisBoundary: lineage.application.gisBoundary ?? null,
      biocharAppliedTons: lineage.application.biocharAppliedDryTons ?? 1,
      biocharAppliedDryTons: lineage.application.biocharAppliedDryTons ?? 1,
      sourceAllocation: null,
      soilTemperatureC: lineage.application.soilTemperatureC ?? 15,
      facility: lineage.facility,
      delivery: {
        id: lineage.delivery.id ?? `del-${index + 1}`,
        code: lineage.delivery.code ?? `D-${index + 1}`,
        status: lineage.delivery.status ?? "complete",
        deliveryDate: lineage.delivery.deliveryDate ?? DEFAULT_FACT_DATE,
        massDryKg: lineage.delivery.massDryKg ?? 100,
      },
      order: lineage.order
        ? {
            id: lineage.order.id,
            code: lineage.order.code ?? `O-${index + 1}`,
            orderDate: lineage.order.orderDate ?? DEFAULT_FACT_DATE,
            quantityKg: lineage.order.quantityKg ?? 100,
          }
        : null,
      biocharProduct: {
        id: lineage.biocharProduct?.id ?? `bp-${index + 1}`,
        code: lineage.biocharProduct?.code ?? `BP-${index + 1}`,
        status: lineage.biocharProduct?.status ?? "complete",
        productionDate:
          lineage.biocharProduct?.productionDate ?? DEFAULT_FACT_DATE,
        massKg: lineage.biocharProduct?.massKg ?? 100,
        moistureContentPercent:
          lineage.biocharProduct?.moistureContentPercent ?? 0,
        formulationName: lineage.biocharProduct?.formulationName ?? null,
        linkedProductionRunId:
          lineage.biocharProduct?.linkedProductionRunId ?? runId,
      },
    };
  });
  const normalizedApplications = Array.from(
    new Map(
      applications.map((application) => [application.id, application]),
    ).values(),
  );

  const lineageRuns = Array.from(
    new Map(runs.map((run) => [run.id, run])).values(),
  );
  const coveredRunIds = new Set(lineageRuns.map((run) => run.id));
  const memberOnlyRuns = productionRunIds
    .filter((runId) => !coveredRunIds.has(runId))
    .map((runId) => ({
      id: runId,
      code: runId.toUpperCase(),
      status: memberRunStatusById[runId] ?? "complete",
      date: DEFAULT_FACT_DATE,
      biocharDryMassKg: 100,
      feedstockMassDryKg: 200,
      reactor: null,
      feedstocks: [],
    }));

  return {
    batchId,
    productionRunIds,
    runs: [...lineageRuns, ...memberOnlyRuns],
    applications: normalizedApplications,
    applicationIds: normalizedApplications.map((application) => application.id),
    appliedWeightTons: normalizedApplications.reduce(
      (total, application) => total + application.biocharAppliedTons,
      0,
    ),
  };
}
