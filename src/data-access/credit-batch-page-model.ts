import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  deliveries,
  orders,
  customerLocations,
  creditBatchApplications,
  certifierRemovals,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { buildMassAccounting } from "@/lib/certification/mass-accounting";
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

function sumDryKg(rows: readonly { dryKg: number }[]): number {
  return rows.reduce((sum, row) => sum + row.dryKg, 0);
}

export async function getCreditBatchPageModel(ctx: OrgContext, creditBatchId: string) {
  requireOrgScope(ctx);
  const rollup = (await loadCreditBatchRollups(ctx, [creditBatchId]))[creditBatchId];
  if (!rollup) throw new DomainError("not_found", "Credit batch not found.");

  const [sliceRows, links] = await Promise.all([
    db.select({
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
    listCreditBatchCertificationLinks(ctx, [creditBatchId]),
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
      ? db.select()
          .from(certifierRemovals)
          .where(and(
            inArray(certifierRemovals.id, removalIds),
            eq(certifierRemovals.organizationId, ctx.organizationId),
          ))
          .orderBy(asc(certifierRemovals.createdAt), asc(certifierRemovals.id))
      : [],
    getLatestSubmissionsForEntities(ctx, {
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityIds: removalIds,
    }, rollup.batch.facilityId),
  ]);
  const removals = rows.map(row => {
    const submission = submissions.get(row.id) ?? null;
    const window = { startedOn: row.startedOn, completedOn: row.completedOn };
    const status = deriveSubmissionStatus(
      submission,
      submission ? isLockedInFlight(submission) : false,
      "removal",
      window,
    );
    // Mass is submitted only for a submitted/accepted ledger row with no
    // interrupted reporting window. Rejected, superseded and in-flight drafts
    // stay draft; a lock alone does not undo an already submitted ledger row.
    const isSubmitted =
      (submission?.status === "submitted" || submission?.status === "accepted") &&
      !isRemovalSubmissionInterruptedFromSubmission(submission, window);
    const phase: "draft" | "submitted" = isSubmitted ? "submitted" : "draft";
    return {
      id: row.id,
      code: row.code,
      status,
      phase,
      createdAt: row.createdAt,
      submittedAt: submission?.submittedAt ?? null,
      ghgStatementId: row.ghgStatementId,
      dryKg: sumDryKg(slices.filter(slice => slice.removalId === row.id)),
    };
  });
  const { runSummary } = buildMassAccounting([], rollup.lineageFacts.runs);
  const producedDryKg = rollup.lineageFacts.runs.some(run => run.biocharDryMassKg !== null)
    ? runSummary.totalBiocharOutputKg
    : null;
  // Persisted slices are the frozen allocation authority, including when an
  // application spans batches. Never use the list's wet appliedWeightTons.
  const appliedDryKg = sumDryKg(slices);
  const firstSubmitted = removals
    .filter(row => row.phase === "submitted" && row.submittedAt)
    .sort((a, b) => a.submittedAt!.getTime() - b.submittedAt!.getTime())
    .at(0);
  // Match CreditBatchHealthSummary: the newest holding Removal (createdAt,
  // then id descending), even when an older Removal has a statement and it doesn't.
  const statementId = links.find(link => link.removalId !== null)?.ghgStatementId;
  const statement = statementId ? await getCertifierGhgStatementById(ctx, statementId) : null;
  let ghgStatement: CreditBatchPageGhgStatement | null = null;
  if (statement) {
    const statementSubmissions = await getLatestSubmissionsForEntities(ctx, {
      provider: "isometric",
      submissionType: "ghg_statement",
      localEntityType: "ghgStatement",
      localEntityIds: [statement.id],
    }, rollup.batch.facilityId);
    const latest = statementSubmissions.get(statement.id) ?? null;
    const metadata = latest?.metadata as Record<string, unknown> | null;
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
      submittedToVerifierAt: typeof metadata?.submittedToVerifierAt === "string"
        ? metadata.submittedToVerifierAt
        : null,
      creditsIssuedAt: typeof metadata?.creditsIssuedAt === "string"
        ? metadata.creditsIssuedAt
        : null,
    };
  }
  return {
    creditBatchId,
    facilityId: rollup.batch.facilityId,
    slices,
    removals,
    mass: {
      producedDryKg,
      appliedDryKg,
      inSubmittedDryKg: sumDryKg(removals.filter(row => row.phase === "submitted")),
      inDraftDryKg: sumDryKg(removals.filter(row => row.phase === "draft")),
      notInRemovalDryKg: sumDryKg(slices.filter(slice => slice.removalId === null)),
      notAppliedDryKg: producedDryKg === null ? null : Math.max(0, producedDryKg - appliedDryKg),
    },
    milestones: {
      firstRemovalSubmittedAt: firstSubmitted?.submittedAt ?? null,
      firstRemovalSubmittedCode: firstSubmitted?.code ?? null,
      ghgStatement,
    },
  };
}
