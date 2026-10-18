import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  applications,
  deliveries,
  orders,
  customerLocations,
  creditBatchApplications,
  certifierRemovals,
  certificationSubmissions,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { GRAMS_PER_KG, massGrams } from "@/lib/calculations/gram-allocation";
import { getMetadataValue } from "@/lib/certification/submission-metadata";
import {
  deriveSubmissionStatus,
  isRemovalSubmissionInterruptedFromSubmission,
} from "@/lib/certification/from-submission";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { requireOrgScope } from "./utils";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { getLatestSubmissionsForEntities } from "./certification";
import { listCreditBatchCertificationLinks } from "./credit-batch-certification-links";
import {
  getCertifierGhgStatementById,
  getEffectiveReportingPeriodEndOn,
  hasMissingRemotePeriod,
} from "./certifier-ghg-statements";

const PAGE_MODEL_SNAPSHOT = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

/** All mass is dry biochar kg except the explicitly named slice wetKg. */
export type CreditBatchPageModel = Awaited<ReturnType<typeof getCreditBatchPageModel>>;

export interface CreditBatchPageGhgStatement {
  id: string;
  reportingPeriodStartOn: string | null;
  reportingPeriodEndOn: string | null;
  hasMissingPeriod: boolean;
  status: ReturnType<typeof deriveSubmissionStatus>["kind"];
  submittedToVerifierAt: string | null;
  creditsIssuedAt: string | null;
}

function sumDryGrams(rows: readonly { dryKg: number }[]): number {
  return rows.reduce((sum, row) => sum + massGrams(row.dryKg), 0);
}

export async function getCreditBatchPageModel(ctx: OrgContext, creditBatchId: string) {
  requireOrgScope(ctx);
  // Slice ownership and Removal deletion commit together. Keep every nested
  // read on this executor so they share a snapshot and never re-enter the pool.
  return db.transaction(tx => loadCreditBatchPageModel(ctx, creditBatchId, tx), PAGE_MODEL_SNAPSHOT);
}

async function loadCreditBatchPageModel(ctx: OrgContext, creditBatchId: string, tx: DbTransaction) {
  requireOrgScope(ctx);
  const rollup = (await loadCreditBatchRollups(ctx, [creditBatchId], undefined, tx))[creditBatchId];
  if (!rollup) throw new DomainError("not_found", "Credit batch not found.");

  const [sliceRows, links] = await Promise.all([
    tx.select({
      applicationId: applications.id,
      applicationCode: applications.code,
      applicationDate: applications.applicationDate,
      deliveryId: deliveries.id,
      deliveryCode: deliveries.code,
      field: applications.fieldIdentifier,
      location: customerLocations.name,
      wetKg: creditBatchApplications.allocatedWetMassKg,
      dryKg: creditBatchApplications.allocatedDryMassKg,
      removalId: creditBatchApplications.removalId,
    })
      .from(creditBatchApplications)
      .innerJoin(applications, and(
        eq(applications.id, creditBatchApplications.applicationId),
        eq(applications.organizationId, ctx.organizationId),
      ))
      .innerJoin(deliveries, and(
        eq(deliveries.id, applications.deliveryId),
        eq(deliveries.organizationId, ctx.organizationId),
      ))
      .leftJoin(orders, and(
        eq(orders.id, deliveries.orderId),
        eq(orders.organizationId, ctx.organizationId),
      ))
      .leftJoin(customerLocations, and(
        eq(customerLocations.id, orders.customerLocationId),
        eq(customerLocations.organizationId, ctx.organizationId),
      ))
      .where(and(
        eq(creditBatchApplications.creditBatchId, creditBatchId),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ))
      .orderBy(asc(applications.applicationDate), asc(applications.id)),
    listCreditBatchCertificationLinks(ctx, [creditBatchId], tx),
  ]);
  const slices = sliceRows.map(({ field, location, ...slice }) => {
    const destinationLabel = field?.trim() || location?.trim();
    return {
      ...slice,
      ...(destinationLabel ? { destinationLabel } : {}),
    };
  });
  const removalIds = [...new Set(
    slices.flatMap(slice => slice.removalId ? [slice.removalId] : []),
  )];
  const [rows, submissions] = await Promise.all([
    removalIds.length
      ? tx.select()
          .from(certifierRemovals)
          .where(and(
            inArray(certifierRemovals.id, removalIds),
            eq(certifierRemovals.organizationId, ctx.organizationId),
          ))
          .orderBy(asc(certifierRemovals.createdAt), asc(certifierRemovals.id))
      : [],
    removalIds.length
      ? tx.select().from(certificationSubmissions)
          .innerJoin(certifierRemovals, and(
            eq(certifierRemovals.id, certificationSubmissions.localEntityId),
            eq(certifierRemovals.organizationId, ctx.organizationId),
            eq(certifierRemovals.facilityId, rollup.batch.facilityId),
          ))
          .where(and(
            eq(certificationSubmissions.organizationId, ctx.organizationId),
            eq(certificationSubmissions.provider, "isometric"),
            eq(certificationSubmissions.submissionType, "removal"),
            eq(certificationSubmissions.localEntityType, "removal"),
            inArray(certificationSubmissions.localEntityId, removalIds),
          ))
          .orderBy(desc(certificationSubmissions.version))
      : [],
  ]);
  const removals = rows.map(row => {
    const versions = submissions
      .map(result => result.certification_submissions)
      .filter(version => version.localEntityId === row.id);
    const submission = versions[0] ?? null;
    const submittedVersions = versions.filter(version =>
      version.status === "submitted" || version.status === "accepted",
    );
    // Superseding a submitted version preserves its original registry timestamp.
    const submittedAt = versions.flatMap(version =>
      (version.status === "submitted" || version.status === "accepted" || version.status === "superseded") && version.submittedAt
        ? [version.submittedAt]
        : [],
    )
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const window = { startedOn: row.startedOn, completedOn: row.completedOn };
    const status = deriveSubmissionStatus(
      submission,
      submission ? isLockedInFlight(submission) : false,
      "removal",
      window,
    );
    // A newer draft does not undo an earlier submitted version.
    const isSubmitted = submittedVersions.some(version =>
      !isRemovalSubmissionInterruptedFromSubmission(version, window),
    );
    const phase: "draft" | "submitted" = isSubmitted ? "submitted" : "draft";
    return {
      id: row.id,
      code: row.code,
      status,
      phase,
      createdAt: row.createdAt,
      submittedAt,
      ghgStatementId: row.ghgStatementId,
      dryKg: sumDryGrams(slices.filter(slice => slice.removalId === row.id)) / GRAMS_PER_KG,
    };
  });
  const runs = rollup.lineageFacts.runs;
  const producedDryGrams = runs.length > 0 && runs.every(run => run.biocharDryMassKg !== null)
    ? sumDryGrams(runs.map(run => ({ dryKg: run.biocharDryMassKg! })))
    : null;
  // Persisted slices are the frozen allocation authority, including when an
  // application spans batches. Never use the list's wet appliedWeightTons.
  const appliedDryGrams = sumDryGrams(slices);
  const firstSubmitted = removals
    .filter(row => row.phase === "submitted" && row.submittedAt)
    .sort((a, b) => a.submittedAt!.getTime() - b.submittedAt!.getTime())
    .at(0);
  // Match CreditBatchHealthSummary: the newest holding Removal (createdAt,
  // then id descending), even when an older Removal has a statement and it doesn't.
  const statementId = links.find(link => link.removalId !== null)?.ghgStatementId;
  const statement = statementId ? await getCertifierGhgStatementById(ctx, statementId, tx) : null;
  let ghgStatement: CreditBatchPageGhgStatement | null = null;
  if (statement) {
    const statementSubmissions = await getLatestSubmissionsForEntities(ctx, {
      provider: "isometric",
      submissionType: "ghg_statement",
      localEntityType: "ghgStatement",
      localEntityIds: [statement.id],
    }, rollup.batch.facilityId, tx);
    const latest = statementSubmissions.get(statement.id) ?? null;
    const submittedToVerifierAt = getMetadataValue(latest?.metadata, "submittedToVerifierAt");
    const creditsIssuedAt = getMetadataValue(latest?.metadata, "creditsIssuedAt");
    ghgStatement = {
      id: statement.id,
      reportingPeriodStartOn: statement.reportingPeriodStartOn,
      reportingPeriodEndOn: getEffectiveReportingPeriodEndOn(statement),
      hasMissingPeriod: hasMissingRemotePeriod(statement),
      status: deriveSubmissionStatus(
        latest,
        latest ? isLockedInFlight(latest) : false,
        "ghgStatement",
        "unknown",
      ).kind,
      submittedToVerifierAt: typeof submittedToVerifierAt === "string"
        ? submittedToVerifierAt
        : null,
      creditsIssuedAt: typeof creditsIssuedAt === "string"
        ? creditsIssuedAt
        : null,
    };
  }
  return {
    creditBatchId,
    facilityId: rollup.batch.facilityId,
    slices,
    removals,
    mass: {
      producedDryKg: producedDryGrams === null ? null : producedDryGrams / GRAMS_PER_KG,
      appliedDryKg: appliedDryGrams / GRAMS_PER_KG,
      inSubmittedDryKg: sumDryGrams(removals.filter(row => row.phase === "submitted")) / GRAMS_PER_KG,
      inDraftDryKg: sumDryGrams(removals.filter(row => row.phase === "draft")) / GRAMS_PER_KG,
      notInRemovalDryKg: sumDryGrams(slices.filter(slice => slice.removalId === null)) / GRAMS_PER_KG,
      notAppliedDryKg: producedDryGrams === null ? null : Math.max(0, producedDryGrams - appliedDryGrams) / GRAMS_PER_KG,
    },
    milestones: {
      firstRemovalSubmittedAt: firstSubmitted?.submittedAt ?? null,
      firstRemovalSubmittedCode: firstSubmitted?.code ?? null,
      ghgStatement,
    },
  };
}
