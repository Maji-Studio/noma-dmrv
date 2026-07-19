import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type {
  BatchLineageApplicationFact,
  BatchLineageRunFact,
} from "@/data-access/credit-batch-lineage-facts";

export function projectCertificationLineage(
  application: BatchLineageApplicationFact,
  run: BatchLineageRunFact,
): ChainOfCustodyData {
  return {
    facility: application.facility,
    application: {
      id: application.id,
      code: application.code,
      status: application.status,
      applicationDate: application.applicationDate,
      fieldIdentifier: application.fieldIdentifier,
      evidenceMethod: application.evidenceMethod,
      gisBoundaryReference: application.gisBoundaryReference,
      biocharAppliedDryTons: application.biocharAppliedDryTons,
      soilTemperatureC: application.soilTemperatureC,
      href: "/applications",
    },
    delivery: { ...application.delivery, href: "/deliveries" },
    order: application.order
      ? { ...application.order, href: "/orders" }
      : null,
    biocharProduct: {
      ...application.biocharProduct,
      href: "/biochar-products",
    },
    productionRun: {
      id: run.id,
      code: run.code,
      status: run.status,
      date: run.date,
      biocharDryMassKg: run.biocharDryMassKg,
      feedstockMassDryKg: run.feedstockMassDryKg,
      href: "/production-runs",
    },
    reactor: run.reactor ? { ...run.reactor, href: "/reactors" } : null,
    feedstocks: run.feedstocks.map((feedstock) => ({
      ...feedstock,
      href: "/feedstocks",
    })),
    warnings:
      run.feedstocks.length === 0
        ? [
            "The linked production run does not have any recorded feedstock allocations.",
          ]
        : [],
  };
}
