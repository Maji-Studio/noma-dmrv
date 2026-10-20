import { formatCertifierMappingLockMessage } from "@/lib/certification/lineage-lock-message";
import { DomainError } from "@/lib/domain-errors";
import { insertDocument } from "./documents";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { isPgUniqueViolation } from "@/db/errors";
import {
  certifierGhgStatements,
  certifierProjects,
  certifierRemovals,
  certificationSubmissions,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { documents } from "@/db/schema/documentation";
import { facilities } from "@/db/schema/facilities";
import { isTerminalAttemptStatus, isRemoteSubmission, submissionHasRemoteEffect } from "@/lib/record-lock";
import { DEFAULT_PROTOCOL_SLUG } from "@/config/certification";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SCOPED_SUBMISSION_TYPES,
} from "@/lib/isometric/utils/constants";
import { SafeError } from "@/lib/errors";
import { pluralize } from "@/lib/copy-utils";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";
import {
  hasStorageLocationRegistrationForExternalProject,
} from "./certifier-storage-locations";
import { withCertifierProjectMappingLocks } from "./certifier-project-mapping-locks";
import { adoptCreditBatchesForIsometric } from "./certifier-project-credit-batches";

type CertifierProvider = (typeof certifierProjects.$inferSelect)["provider"];
export type CertifierProjectRow = typeof certifierProjects.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export { appendSyncEvent, listRecentSyncEvents } from "./certifier-sync-events";
export type { AppendSyncEventInput } from "./certifier-sync-events";

export interface UpsertCertifierProjectInput {
  facilityId: string;
  provider: CertifierProvider;
  externalProjectId: string;
  protocolSlug?: string;
  protocolVersion?: string | null;
  defaultRemovalTemplateId?: string | null;
  // Operator-pasted Isometric facility id (fcl_…).
  externalFacilityId: string;
  metadata?: Record<string, unknown> | null;
}

export interface LinkedFacilitySummary {
  facilityId: string;
  code: string;
  name: string;
}

export async function getCertifierProjectByFacility(
  ctx: OrgContext,
  facilityId: string,
  provider: CertifierProvider = "isometric",
): Promise<CertifierProjectRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certifierProjects)
    .where(
      and(
        eq(certifierProjects.facilityId, facilityId),
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listFacilitiesLinkedToExternal(
  ctx: OrgContext,
  provider: CertifierProvider,
  externalProjectId: string,
): Promise<LinkedFacilitySummary[]> {
  requireOrgScope(ctx);
  const rows = await db
    .select({
      facilityId: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(certifierProjects)
    .innerJoin(facilities, and(eq(certifierProjects.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(
      and(
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.externalProjectId, externalProjectId),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    );
  return rows;
}

export interface LinkedFacilityByProject extends LinkedFacilitySummary {
  externalProjectId: string;
}

export async function listAllFacilitiesLinkedByProvider(
  ctx: OrgContext,
  provider: CertifierProvider,
): Promise<LinkedFacilityByProject[]> {
  requireOrgScope(ctx);
  return db
    .select({
      externalProjectId: certifierProjects.externalProjectId,
      facilityId: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(certifierProjects)
    .innerJoin(facilities, and(eq(certifierProjects.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(certifierProjects.provider, provider), eq(certifierProjects.organizationId, ctx.organizationId)));
}

export { markSubmissionSubmitted, retireStaleSubmissionDraft, markSubmissionRejected, appendSubmissionJournal, updateSubmissionMetadata, setSubmissionTerminalStatus, clearTerminalStatusForResubmit } from "./submission-ledger-transitions";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Exported for the facility archive-with-warning gate (archive stays allowed;
// the dialog surfaces a warning when registry submissions exist).
export async function hasBlockingFacilitySubmission(
  ctx: OrgContext,
  executor: Tx | typeof db,
  facilityId: string,
  provider: CertifierProvider,
): Promise<boolean> {
  requireOrgScope(ctx);
  // Two facility-scoped artifacts can pin a mapping: a Removal (ADR 0003)
  // and a GHG Statement (ADR 0004). Read every ledger version through
  // each artifact's facility index; a later failure cannot hide a remote effect.
  const [removalHit, ghgHit] = await Promise.all([
    executor
      .select({ id: certificationSubmissions.id, status: certificationSubmissions.status, externalId: certificationSubmissions.externalId, metadata: certificationSubmissions.metadata })
      .from(certificationSubmissions)
      .innerJoin(
        certifierRemovals,
        and(eq(certificationSubmissions.localEntityId, certifierRemovals.id), eq(certifierRemovals.organizationId, ctx.organizationId)),
      )
      .where(
        and(
          eq(certificationSubmissions.provider, provider),
          eq(certificationSubmissions.localEntityType, "removal"),
          inArray(
            certificationSubmissions.submissionType,
            REMOVAL_SCOPED_SUBMISSION_TYPES,
          ),
          eq(certifierRemovals.facilityId, facilityId),
          eq(certificationSubmissions.organizationId, ctx.organizationId),
        ),
      ),
    executor
      .select({ id: certificationSubmissions.id, status: certificationSubmissions.status, externalId: certificationSubmissions.externalId, metadata: certificationSubmissions.metadata })
      .from(certificationSubmissions)
      .innerJoin(
        certifierGhgStatements,
        and(eq(certificationSubmissions.localEntityId, certifierGhgStatements.id), eq(certifierGhgStatements.organizationId, ctx.organizationId)),
      )
      .where(
        and(
          eq(certificationSubmissions.provider, provider),
          eq(certificationSubmissions.localEntityType, "ghgStatement"),
          eq(certificationSubmissions.submissionType, "ghg_statement"),
          eq(certifierGhgStatements.facilityId, facilityId),
          eq(certificationSubmissions.organizationId, ctx.organizationId),
        ),
      ),
  ]);
  return [...removalHit, ...ghgHit].some(row => !isTerminalAttemptStatus(row.status) ||
    isRemoteSubmission({ status: row.status, hasRemoteMutation: submissionHasRemoteEffect(row) }));
}

// DB-level backstop for the (provider, external_facility_id) 1:1 anchor. The
// serial in-transaction probe in upsertCertifierProject cannot see a concurrent
// upsert (each only row-locks its own facility), so the unique index fires for
// the loser. Relabel that one 23505 as a clear SafeError; every other error
// (including the entity-version 23505 handled elsewhere) propagates unchanged.
const CERTIFIER_EXTERNAL_FACILITY_CONSTRAINT =
  "certifier_projects_provider_external_facility_unique";

async function withExternalFacilityConflictGuard<T>(
  externalFacilityId: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isPgUniqueViolation(err, CERTIFIER_EXTERNAL_FACILITY_CONSTRAINT)) {
      throw new SafeError(
        `Isometric facility ID ${externalFacilityId} is already linked to another facility. Each Isometric facility maps to exactly one facility here.`,
      );
    }
    throw err;
  }
}

export async function upsertCertifierProject(
  ctx: OrgContext,
  input: UpsertCertifierProjectInput,
): Promise<CertifierProjectRow> {
  requireOrgScope(ctx);
  const values = {
    organizationId: ctx.organizationId,
    facilityId: input.facilityId,
    provider: input.provider,
    externalProjectId: input.externalProjectId,
    protocolSlug: input.protocolSlug ?? DEFAULT_PROTOCOL_SLUG,
    protocolVersion: input.protocolVersion ?? null,
    defaultRemovalTemplateId: input.defaultRemovalTemplateId ?? null,
    externalFacilityId: input.externalFacilityId,
    metadata: input.metadata ?? null,
  };

  if (!values.externalFacilityId.trim()) {
    throw new SafeError("Set an Isometric facility ID before saving the facility link.");
  }

  const runUpsert = () =>
    db.transaction(async (tx) => {
      if (input.provider === "isometric") {
        await adoptCreditBatchesForIsometric(ctx, tx, input.facilityId);
      }
      const [existing] = await tx
        .select()
        .from(certifierProjects)
        .where(
          and(
            eq(certifierProjects.facilityId, input.facilityId),
            eq(certifierProjects.provider, input.provider),
            eq(certifierProjects.organizationId, ctx.organizationId),
          ),
        )
        .for("update")
        .limit(1);

      // The Isometric facility id (fcl_…) is a 1:1 anchor — two noma facilities
      // sharing one would cross-contaminate registry production data. The unique
      // constraint (provider, external_facility_id) is the backstop; this in-transaction
      // probe turns the raw 23505 into a clear, actionable message naming the
      // colliding facility. Projects may still be shared across facilities —
      // only the fcl_ id is locked. Two concurrent upserts can each pass this
      // probe (each row-locks only its own facility), so the DB constraint
      // still fires for one — withExternalFacilityConflictGuard catches it.
      const [collision] = await tx
        .select({
          code: facilities.code,
          name: facilities.name,
        })
        .from(certifierProjects)
        .innerJoin(facilities, and(eq(certifierProjects.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
        .where(
          and(
            eq(certifierProjects.provider, input.provider),
            eq(
              certifierProjects.externalFacilityId,
              values.externalFacilityId,
            ),
            ne(certifierProjects.facilityId, input.facilityId),
            eq(certifierProjects.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      if (collision) {
        throw new SafeError(
          `Isometric facility ID ${values.externalFacilityId} is already linked to ${collision.code}: ${collision.name}. Each Isometric facility maps to one noma facility.`,
        );
      }

      // Remote effects keep the registry mapping fixed until their Removal is deleted.
      const mappingIdentifiersChanged =
        existing &&
        (existing.externalProjectId !== values.externalProjectId ||
          existing.externalFacilityId !== values.externalFacilityId);
      if (mappingIdentifiersChanged) {
        const blocked = await hasBlockingFacilitySubmission(
          ctx,
          tx,
          input.facilityId,
          input.provider,
        );
        if (blocked) {
          throw new DomainError(
            "certification_locked",
            formatCertifierMappingLockMessage("change"),
          );
        }
        if (
          existing.externalProjectId !== values.externalProjectId &&
          (await hasStorageLocationRegistrationForExternalProject(
            ctx,
            tx,
            existing.provider,
            existing.externalProjectId,
          ))
        ) {
          throw new SafeError(
            "Cannot change the certifier project: this Isometric project has registered application sites. Keep the current project mapping to preserve their registry identities.",
          );
        }
      }

      // org-scope-ok: values includes the active organization id.
      const [row] = await tx
        .insert(certifierProjects)
        .values(values)
        .onConflictDoUpdate({
          target: [certifierProjects.facilityId, certifierProjects.provider],
          set: {
            externalProjectId: values.externalProjectId,
            protocolSlug: values.protocolSlug,
            // The supported settings form does not expose protocol version.
            // Preserve an audited value only while saving the same project.
            // A rebind clears the old project's value until the new project is
            // audited; explicit null also remains available to clear it.
            protocolVersion:
              input.protocolVersion === undefined
                ? sql<string | null>`case
                    when ${certifierProjects.externalProjectId} = ${values.externalProjectId}
                    then ${certifierProjects.protocolVersion}
                    else null
                  end`
                : values.protocolVersion,
            defaultRemovalTemplateId: input.defaultRemovalTemplateId === undefined
              ? existing?.externalProjectId === values.externalProjectId
                ? existing.defaultRemovalTemplateId
                : null
              : values.defaultRemovalTemplateId,
            externalFacilityId: values.externalFacilityId,
            metadata: values.metadata,
            updatedAt: sql`now()`,
          },
          setWhere: eq(certifierProjects.organizationId, ctx.organizationId),
        })
        .returning();
      // A false `setWhere` means another organization owns the row, so nothing is updated and `returning()` is empty.
      if (!row) {
        throw new Error(
          `Certifier project mapping for facility ${input.facilityId} belongs to another organization`,
        );
      }
      return row;
    });

  return withCertifierProjectMappingLocks(
    ctx,
    {
      facilityId: input.facilityId,
      provider: input.provider,
      targetExternalProjectId: values.externalProjectId,
    },
    () => withExternalFacilityConflictGuard(values.externalFacilityId, runUpsert),
  );
}

export async function updateFacilityDefaultRemovalTemplate(
  ctx: OrgContext,
  input: { facilityId: string; externalProjectId: string; removalTemplateId: string },
): Promise<CertifierProjectRow> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  return db.transaction(async (tx) => {
    const [facility] = await tx.select({ id: facilities.id }).from(facilities).where(and(
      eq(facilities.organizationId, ctx.organizationId),
      eq(facilities.id, input.facilityId),
      isNull(facilities.archivedAt),
    )).for("share");
    if (!facility) throw new SafeError("Facility not found or archived.");
    const [row] = await tx.update(certifierProjects).set({
      defaultRemovalTemplateId: input.removalTemplateId, updatedAt: sql`now()`,
    }).where(and(
      eq(certifierProjects.organizationId, ctx.organizationId),
      eq(certifierProjects.facilityId, input.facilityId),
      eq(certifierProjects.provider, "isometric"),
      eq(certifierProjects.externalProjectId, input.externalProjectId),
    )).returning();
    if (!row) throw new SafeError("The facility's Isometric project link changed. Refresh and try again.");
    return row;
  });
}

export interface FacilityEmissionConfigInput {
  facilityId: string;
  provider?: CertifierProvider;
  defaultSoilTemperatureC?: number | null;
  defaultSoilTemperatureSource?: string | null;
}

// Updates only the emission-config columns on an existing
// certifier_projects row: the reference soil-temperature value and its dataset
// citation. ADR 0015 dropped the three stage-split columns. The facility must already be linked to an Isometric
// project — the config has no meaning otherwise.
export async function updateFacilityEmissionConfig(
  ctx: OrgContext,
  input: FacilityEmissionConfigInput,
): Promise<CertifierProjectRow> {
  requireOrgScope(ctx);
  const provider = input.provider ?? "isometric";
  const [row] = await db
    .update(certifierProjects)
    .set({
      defaultSoilTemperatureC: input.defaultSoilTemperatureC ?? null,
      defaultSoilTemperatureSource: input.defaultSoilTemperatureSource ?? null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierProjects.facilityId, input.facilityId),
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  if (!row) {
    throw new SafeError(
      `Link this facility to a ${provider} project before setting emission estimates.`,
    );
  }
  return row;
}

export async function deleteCertifierProject(
  ctx: OrgContext,
  facilityId: string,
  provider: CertifierProvider = "isometric",
): Promise<void> {
  requireOrgScope(ctx);

  await withCertifierProjectMappingLocks(
    ctx,
    {
      facilityId,
      provider,
    },
    () => db.transaction(async (tx) => {
    // Lock the mapping row so a concurrent submission insert that depends on
    // this mapping cannot race the unlink check.
    const [mapping] = await tx
      .select({
        externalProjectId: certifierProjects.externalProjectId,
        provider: certifierProjects.provider,
      })
      .from(certifierProjects)
      .where(
        and(
          eq(certifierProjects.facilityId, facilityId),
          eq(certifierProjects.provider, provider),
          eq(certifierProjects.organizationId, ctx.organizationId),
        ),
      )
      .for("update")
      .limit(1);

    // Unlink guard: refuse if any facility-scoped certifier removal
    // submission depends on this mapping.
    const blocked = await hasBlockingFacilitySubmission(ctx, tx, facilityId, provider);
    if (blocked) {
      throw new DomainError(
        "certification_locked",
        formatCertifierMappingLockMessage("unlink"),
      );
    }

    if (
      mapping &&
      (await hasStorageLocationRegistrationForExternalProject(
        ctx,
        tx,
        mapping.provider,
        mapping.externalProjectId,
      ))
    ) {
      throw new SafeError(
        "Cannot unlink: this Isometric project has registered application sites. Keep the project mapping to preserve their registry identities.",
      );
    }

    await tx
      .delete(certifierProjects)
      .where(
        and(
          eq(certifierProjects.facilityId, facilityId),
          eq(certifierProjects.provider, provider),
          eq(certifierProjects.organizationId, ctx.organizationId),
        ),
      );
    }),
  );
}

// =====================================================================
// Submission ledger
// =====================================================================
//
// The claim choreography (latest read → decide → mapping lock → re-decide →
// insert/reset draft) lives in `./certification-submissions` —
// `claimSubmissionDraft` is the single entry point. This file keeps the
// post-claim transitions (submitted / rejected / terminal), the batched and
// by-id reads, and the sync-event journal.

export type CertificationSubmissionRow =
  typeof certificationSubmissions.$inferSelect;
export type CertifierSyncEventRow = typeof certifierSyncEvents.$inferSelect;

// =====================================================================
// Resolved-facility scope (defence in depth — issue #277)
// =====================================================================
//
// Every certification submission is anchored to a Removal or a GHG Statement,
// both of which carry `facilityId` directly. These helpers resolve the facility
// that OWNS a submission from that anchor row — never a client-supplied field —
// so id/key-addressed reads can be refused when they cross a facility boundary,
// mirroring reconcileRemovalMembership's step-0 facility resolve.
//
// This is NOT per-user membership, and it is NOT (yet) cross-facility
// authorization. There is no membership model (issue #372 / ADR 0010) and no
// independent active-facility context on the server actions, so today every
// wired caller derives `expectedFacilityId` from the *same* anchor id it is
// operating on. That makes the comparison lineage-consistency, whose only
// live rejection is a dangling/unresolvable anchor (fail-closed) — a genuine
// cross-facility id swap can only be rejected once an *independent* facility
// (a real membership check or a session-level active facility) is threaded in.
// These helpers are that seam: they resolve a submission's owning facility
// from its anchor row (never a client-supplied field), so the id/key-addressed
// reads can be refused the moment #372 lands an independent value to compare
// against. See docs/open-questions.md `security/certification-submit-authz`.

// `removal` keys `localEntityId` to certifierRemovals.id; `ghgStatement`
// resolves through certifierGhgStatements. Both anchor tables carry facilityId.
//
// Batched facility lookup for a set of local-entity ids of one type. Returns an
// id → facilityId map; ids whose anchor row no longer exists are simply absent.
async function facilityIdsForLocalEntities(
  ctx: OrgContext,
  executor: Tx | typeof db,
  localEntityType: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  if (localEntityType === REMOVAL_ENTITY_TYPE) {
    const rows = await executor
      .select({ id: certifierRemovals.id, facilityId: certifierRemovals.facilityId })
      .from(certifierRemovals)
      .where(and(inArray(certifierRemovals.id, ids), eq(certifierRemovals.organizationId, ctx.organizationId)));
    return new Map(rows.map((r) => [r.id, r.facilityId]));
  }
  if (localEntityType === GHG_STATEMENT_ENTITY_TYPE) {
    const rows = await executor
      .select({
        id: certifierGhgStatements.id,
        facilityId: certifierGhgStatements.facilityId,
      })
      .from(certifierGhgStatements)
      .where(and(inArray(certifierGhgStatements.id, ids), eq(certifierGhgStatements.organizationId, ctx.organizationId)));
    return new Map(rows.map((r) => [r.id, r.facilityId]));
  }
  return new Map();
}

// Resolves the facility that owns a submission row via its anchor entity.
// Returns null for an unknown local-entity type or a dangling anchor.
export async function resolveSubmissionFacilityId(
  ctx: OrgContext,
  executor: Tx | typeof db,
  row: Pick<CertificationSubmissionRow, "localEntityType" | "localEntityId">,
): Promise<string | null> {
  requireOrgScope(ctx);
  const byId = await facilityIdsForLocalEntities(ctx, executor, row.localEntityType, [
    row.localEntityId,
  ]);
  return byId.get(row.localEntityId) ?? null;
}

// Throws SafeError unless the submission's resolved facility matches the one the
// caller is operating within. Fail-closed: an unresolvable anchor is refused
// rather than allowed (a submission whose facility can't be proven must not be
// acted on across a boundary).
export async function assertSubmissionInFacility(
  ctx: OrgContext,
  executor: Tx | typeof db,
  row: Pick<CertificationSubmissionRow, "localEntityType" | "localEntityId">,
  expectedFacilityId: string,
): Promise<void> {
  requireOrgScope(ctx);
  const facilityId = await resolveSubmissionFacilityId(ctx, executor, row);
  if (facilityId !== expectedFacilityId) {
    throw new SafeError("Submission does not belong to this facility.");
  }
}

// Batched sibling of getLatestSubmission — one round-trip for N local
// entities. DISTINCT ON keeps the highest-version row per localEntityId, the
// same "latest" rule as getLatestSubmission. Returns a localEntityId → row
// map; entities with no submission are simply absent.
export async function getLatestSubmissionsForEntities(
  ctx: OrgContext,
  key: {
    provider: CertifierProvider;
    submissionType: string;
    localEntityType: string;
    localEntityIds: string[];
  },
  // Defence-in-depth facility scope (issue #277). When set, rows whose anchor
  // entity lives in a different facility are dropped from the result — a
  // batched read must not leak another facility's ledger rows.
  expectedFacilityId?: string,
  executor: Tx | typeof db = db,
): Promise<Map<string, CertificationSubmissionRow>> {
  requireOrgScope(ctx);
  if (key.localEntityIds.length === 0) return new Map();
  const rows = await executor
    .selectDistinctOn([certificationSubmissions.localEntityId])
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, key.provider),
        eq(certificationSubmissions.submissionType, key.submissionType),
        eq(certificationSubmissions.localEntityType, key.localEntityType),
        inArray(certificationSubmissions.localEntityId, key.localEntityIds),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(
      certificationSubmissions.localEntityId,
      desc(certificationSubmissions.version),
    );
  if (expectedFacilityId === undefined) {
    return new Map(rows.map((row) => [row.localEntityId, row]));
  }
  const facilityById = await facilityIdsForLocalEntities(
    ctx,
    executor,
    key.localEntityType,
    rows.map((row) => row.localEntityId),
  );
  return new Map(
    rows
      .filter(
        (row) => facilityById.get(row.localEntityId) === expectedFacilityId,
      )
      .map((row) => [row.localEntityId, row]),
  );
}

export async function getSubmissionById(
  ctx: OrgContext,
  id: string,
  // Defence-in-depth facility scope (issue #277). When set, a submission whose
  // anchor entity resolves to a different facility is refused (SafeError)
  // instead of returned by raw id.
  expectedFacilityId?: string,
): Promise<CertificationSubmissionRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certificationSubmissions)
    .where(and(eq(certificationSubmissions.id, id), eq(certificationSubmissions.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) return null;
  if (expectedFacilityId !== undefined) {
    await assertSubmissionInFacility(ctx, db, row, expectedFacilityId);
  }
  return row;
}

export async function getSubmissionByExternalId(
  ctx: OrgContext,
  args: {
    provider: CertificationSubmissionRow["provider"];
    submissionType: string;
    externalId: string;
  },
): Promise<CertificationSubmissionRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, args.provider),
        eq(certificationSubmissions.submissionType, args.submissionType),
        eq(certificationSubmissions.externalId, args.externalId),
        eq(
          certificationSubmissions.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function attachReportDocument(
  ctx: OrgContext,
  args: {
    submissionId: string;
    reportUrl: string;
    description: string;
    metadata?: Record<string, unknown>;
  },
): Promise<DocumentRow> {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, certificationSubmissions, args.submissionId);
  const [existing] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.entityType, "ghgStatement"),
        eq(documents.entityId, args.submissionId),
        eq(documents.fileUrl, args.reportUrl),
        eq(documents.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(1);
  if (existing) return existing;
  return insertDocument(ctx, {
    entityType: "ghgStatement",
    entityId: args.submissionId,
    documentType: "pdf",
    fileUrl: args.reportUrl,
    fileName: deriveFileName(args.reportUrl),
    description: args.description,
    metadata: {
      kind: "external_ghg_statement_report",
      ...(args.metadata ?? {}),
    } as Record<string, unknown>,
    createdBy: ctx.userId,
  });
}

function deriveFileName(reportUrl: string): string {
  if (!URL.canParse(reportUrl)) return "ghg-statement-report.pdf";
  const lastSegment = new URL(reportUrl).pathname
    .split("/")
    .filter(Boolean)
    .at(-1);
  return lastSegment || "ghg-statement-report.pdf";
}
