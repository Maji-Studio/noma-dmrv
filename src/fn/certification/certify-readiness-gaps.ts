import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import type {
  BatchEntityReadinessIssue,
  BatchHealthAffectedRecord,
  BatchHealthFixTarget,
} from "@/lib/certification/batch-health";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { TransportCategory } from "./certify-context-core";
import type { TransportLegsByCategory } from "./shared";

// Per-entity certify-readiness gap derivation, factored out of
// `certify-context-core` to keep that orchestrator under the line cap. These
// build the compact gap labels the Review / pre-flight surfaces show; the raw
// entity rows stay server-side.

/**
 * Compact per-entity readiness-gap labels for the removal's production runs,
 * the member batches' pooled lab samples (issue #309: samples anchor on the
 * credit batch, whose declared durability tier they inherit), and the required
 * transport legs.
 */
export function buildEntityReadinessGaps(
  runs: ProductionRunWithSamples[],
  batchesWithSamples: CreditBatchWithSamples[],
  transportLegs: TransportLegsByCategory,
  requiredTransportCategories: readonly TransportCategory[],
): string[] {
  return buildEntityReadinessResult(
    runs,
    batchesWithSamples,
    transportLegs,
    requiredTransportCategories,
  ).gaps;
}

export interface EntityReadinessResult {
  gaps: string[];
  warnings: string[];
  issues: BatchEntityReadinessIssue[];
}

interface IssueAccumulator {
  key: string;
  label: string;
  fixTarget: BatchHealthFixTarget;
  records: Map<string, BatchHealthAffectedRecord>;
}

function addIssueRecord(
  issues: Map<string, IssueAccumulator>,
  config: Omit<IssueAccumulator, "records">,
  record: BatchHealthAffectedRecord,
) {
  const issue = issues.get(config.key) ?? {
    ...config,
    records: new Map<string, BatchHealthAffectedRecord>(),
  };
  const existing = issue.records.get(record.id);
  issue.records.set(record.id, {
    ...record,
    missing: Array.from(
      new Set([...(existing?.missing ?? []), ...record.missing]),
    ),
  });
  issues.set(config.key, issue);
}

export function buildEntityReadinessResult(
  runs: ProductionRunWithSamples[],
  batchesWithSamples: CreditBatchWithSamples[],
  transportLegs: TransportLegsByCategory,
  requiredTransportCategories: readonly TransportCategory[],
): EntityReadinessResult {
  const gaps: string[] = [];
  const warnings: string[] = [];
  const issues = new Map<string, IssueAccumulator>();
  const addEntityGaps = (
    entityLabel: string,
    record: BatchHealthAffectedRecord,
    issueConfig: Omit<IssueAccumulator, "records">,
    readinessGaps: ReturnType<typeof deriveEntityCertifyReadiness>["gaps"],
  ) => {
    if (readinessGaps.length === 0) return;
    const missing = readinessGaps.map((gap) => gap.label);
    gaps.push(
      `${entityLabel}: ${missing.join(" · ")}`,
    );
    addIssueRecord(issues, issueConfig, { ...record, missing });
  };
  // Inert until an entity kind produces warnings again. See the warning channel
  // note in `deriveEntityCertifyReadiness`.
  const addEntityWarnings = (
    entityLabel: string,
    readinessWarnings: ReturnType<
      typeof deriveEntityCertifyReadiness
    >["warnings"],
  ) => {
    warnings.push(
      ...readinessWarnings.map(
        (warning) => `${entityLabel}: ${warning.detail}`,
      ),
    );
  };

  for (const run of runs) {
    const readiness = deriveEntityCertifyReadiness("productionRun", run);
    addEntityGaps(
      `Production run ${run.code}`,
      { id: run.id, code: run.code, missing: [] },
      {
        key: "production-runs",
        label: "Production-run evidence",
        fixTarget: "productionRuns",
      },
      readiness.gaps,
    );
    addEntityWarnings(`Production run ${run.code}`, readiness.warnings);
  }

  for (const batch of batchesWithSamples) {
    for (const sample of batch.samples) {
      const readiness = deriveEntityCertifyReadiness("sample", {
        ...sample,
        durabilityOption: batch.durabilityOption,
        sampling: batch.sampling,
      });
      addEntityGaps(
        `Sample ${sample.sampleCode}`,
        { id: sample.id, code: sample.sampleCode, missing: [] },
        {
          key: "lab-samples",
          label: "Sample evidence",
          fixTarget: "labSamples",
        },
        readiness.gaps,
      );
      addEntityWarnings(`Sample ${sample.sampleCode}`, readiness.warnings);
    }
  }

  for (const category of requiredTransportCategories) {
    const legs = transportLegs[category];
    legs.forEach((leg, index) => {
      const legCode = `${category} transport ${index + 1}`;
      const readiness = deriveEntityCertifyReadiness("transportLeg", leg);
      addEntityGaps(
        legCode,
        {
          id: category === "feedstock" ? leg.entityId : leg.id,
          code: legCode,
          missing: [],
        },
        {
          key: `${category}-transport-evidence`,
          label: `${category[0]?.toUpperCase()}${category.slice(1)} transport evidence`,
          fixTarget:
            category === "feedstock"
              ? "feedstocks"
              : category === "sample"
                ? "labSamples"
                : "deliveries",
        },
        readiness.gaps,
      );
      addEntityWarnings(legCode, readiness.warnings);
    });
  }

  return {
    gaps: Array.from(new Set(gaps)),
    warnings: Array.from(new Set(warnings)),
    issues: Array.from(issues.values()).map((issue) => ({
      key: issue.key,
      label: issue.label,
      fixTarget: issue.fixTarget,
      affectedRecords: Array.from(issue.records.values()),
    })),
  };
}
