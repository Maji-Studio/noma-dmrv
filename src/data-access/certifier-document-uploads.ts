import { and, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { certifierDocumentUploads } from "@/db/schema/certification";
import { certificationSubmissions } from "@/db/schema/certification";
import { documents } from "@/db/schema/documentation";
import type { OrgContext } from "@/lib/auth/server";
import { SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
import { SafeError } from "@/lib/errors";
import { ISOMETRIC_PROVIDER } from "@/lib/isometric/utils/constants";
import { acquireMirrorLocksSorted } from "@/lib/isometric/utils/source-lock";
import { assertSameOrg, requireOrgScope } from "./utils";

type DbClient = DbTransaction | typeof db;

export type CertifierDocumentUploadRow =
  typeof certifierDocumentUploads.$inferSelect;
export type NewCertifierDocumentUploadRow =
  typeof certifierDocumentUploads.$inferInsert;

type CertifierProvider =
  (typeof certifierDocumentUploads.$inferSelect)["provider"];

export interface DocumentUploadMetadata {
  mirroredBy: string;
  supplierRefId: string;
  contentLength: number;
  contentType: string;
  isPublic: boolean;
  // Optional fingerprint of the noma-side bytes at mirror time; informational
  // only — Isometric stores its own checksum server-side.
  fileChecksum?: string;
}

export interface InsertDocumentUploadInput {
  documentId: string;
  provider: CertifierProvider;
  externalDocumentId: string;
  metadata: DocumentUploadMetadata;
}

// Idempotent insert keyed on the (provider, document_id) unique constraint:
// re-mirroring the same document is a no-op. Returns the row plus an
// `inserted` flag so the caller can tell "I won the race and the value I
// posted is authoritative" from "I lost — the externalDocumentId I created
// is now an orphan". The mirror flow emits an orphan-detected sync_event in
// the loser case so an out-of-band sweep can clean up.
export async function insertOrGetDocumentUpload(
  ctx: OrgContext,
  input: InsertDocumentUploadInput,
  txOrDb: DbClient = db,
): Promise<{ row: CertifierDocumentUploadRow; inserted: boolean }> {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, documents, input.documentId, txOrDb);
  const [row] = await txOrDb
    .insert(certifierDocumentUploads)
    .values({
      organizationId: ctx.organizationId,
      documentId: input.documentId,
      provider: input.provider,
      externalDocumentId: input.externalDocumentId,
      metadata: input.metadata as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({
      target: [
        certifierDocumentUploads.provider,
        certifierDocumentUploads.documentId,
      ],
    })
    .returning();
  if (row) return { row, inserted: true };
  const existing = await getDocumentUploadByDocument(
    ctx,
    input.provider,
    input.documentId,
    txOrDb,
  );
  if (!existing) {
    throw new Error(
      `Document upload insert race produced no row for document ${input.documentId}`,
    );
  }
  return { row: existing, inserted: false };
}

export async function getDocumentUploadByDocument(
  ctx: OrgContext,
  provider: CertifierProvider,
  documentId: string,
  txOrDb: DbClient = db,
): Promise<CertifierDocumentUploadRow | null> {
  requireOrgScope(ctx);
  const [row] = await txOrDb
    .select()
    .from(certifierDocumentUploads)
    .where(
      and(
        eq(certifierDocumentUploads.provider, provider),
        eq(certifierDocumentUploads.documentId, documentId),
        eq(certifierDocumentUploads.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listDocumentUploadsForDocuments(
  ctx: OrgContext,
  provider: CertifierProvider,
  documentIds: string[],
  txOrDb: DbClient = db,
): Promise<CertifierDocumentUploadRow[]> {
  requireOrgScope(ctx);
  if (documentIds.length === 0) return [];
  return txOrDb
    .select()
    .from(certifierDocumentUploads)
    .where(
      and(
        eq(certifierDocumentUploads.provider, provider),
        inArray(certifierDocumentUploads.documentId, documentIds),
        eq(certifierDocumentUploads.organizationId, ctx.organizationId),
      ),
    );
}

export async function deleteDocumentUploadByDocument(
  ctx: OrgContext,
  provider: CertifierProvider,
  documentId: string,
  txOrDb: DbClient = db,
): Promise<void> {
  requireOrgScope(ctx);
  await txOrDb
    .delete(certifierDocumentUploads)
    .where(
      and(
        eq(certifierDocumentUploads.provider, provider),
        eq(certifierDocumentUploads.documentId, documentId),
        eq(certifierDocumentUploads.organizationId, ctx.organizationId),
      ),
    );
}

// Every place a Source id can land in a persisted Removal payload: a
// materialized Datapoint body, the immutable source binding plan, or a
// Biochar Application intent.
//
// jsonb_path_exists is the canonical Postgres idiom for "any element of any
// nested array equals X"; using `@>` containment is awkward across nested
// arrays of objects. The explicit ::text cast on $val is required: without
// it, Postgres raises `42P18 — could not determine data type of parameter`
// because jsonb_build_object accepts any, and the planner can't infer the
// type from context. Columns are table-qualified so the predicate also works
// inside a correlated subquery.
function snapshotReferencesSource(sourceId: SQL): SQL {
  const snapshot = certificationSubmissions.payloadSnapshot;
  return sql`(
    jsonb_path_exists(
      ${snapshot},
      '$.transport.datapointBodies[*].body.source_ids[*] ? (@ == $val)',
      jsonb_build_object('val', ${sourceId})
    )
    OR jsonb_path_exists(
      ${snapshot},
      '$.sourceBindingPlan[*].sourceId ? (@ == $val)',
      jsonb_build_object('val', ${sourceId})
    )
    OR jsonb_path_exists(
      ${snapshot},
      '$.transport.biocharApplicationIntents[*].sourceIds[*] ? (@ == $val)',
      jsonb_build_object('val', ${sourceId})
    )
  )`;
}

// A ledger row stamped by Removal deletion describes registry records that
// are gone. Its snapshot stays as the audit trail but pins nothing.
export function submissionIsNotDeleted(): SQL {
  return sql`NOT jsonb_exists(coalesce(${certificationSubmissions.metadata}, '{}'::jsonb), ${SUBMISSION_METADATA_KEYS.deletion}::text)`;
}

export interface SourceReferenceCheckOptions {
  /**
   * Ledger rows to leave out of the check. Removal deletion passes the rows
   * it is about to stamp as deleted, so it can decide the release before
   * writing the stamp.
   */
  ignoreSubmissionIds?: readonly string[];
}

// Checks whether any live submission payload references the given Isometric
// Source id. Used as the unlink-safety guard: if a Source landed in any
// materialized Datapoint body or immutable source binding plan, the local
// mapping cannot be deleted without orphaning the audit trail. Scans every
// status because rejected/superseded snapshots are still real history; only
// rows stamped by Removal deletion are skipped, since the registry records
// their snapshot describes no longer exist.
export async function isExternalSourceReferencedInSnapshots(
  ctx: OrgContext,
  provider: CertifierProvider,
  externalDocumentId: string,
  txOrDb: DbClient = db,
  options: SourceReferenceCheckOptions = {},
): Promise<boolean> {
  requireOrgScope(ctx);
  // Provider scoping is forward-compat: only `isometric` issues source_ids
  // today, but the enum permits `puro_earth` / `verra` and nothing
  // structurally prevents two providers from generating the same source_id
  // string. Without this filter, unlink on provider A could refuse because
  // provider B's payload mentioned the same id.
  const ignored = options.ignoreSubmissionIds ?? [];
  const result = await txOrDb.execute<{ found: number }>(sql`
    SELECT 1 AS found
    FROM ${certificationSubmissions}
    WHERE ${eq(certificationSubmissions.provider, provider)}
      AND ${eq(certificationSubmissions.organizationId, ctx.organizationId)}
      AND ${submissionIsNotDeleted()}
      ${ignored.length > 0 ? sql`AND ${notInArray(certificationSubmissions.id, [...ignored])}` : sql``}
      AND ${snapshotReferencesSource(sql`${externalDocumentId}::text`)}
    LIMIT 1
  `);
  return result.rows.length > 0;
}

export interface ReleasedDocumentUpload {
  documentId: string;
  externalDocumentId: string;
}

export const SOURCE_RELEASE_RACE_ERROR =
  "A Removal submission committed concurrently and now references this document. Deletion was aborted; retry once submission completes.";

const SNAPSHOT_SOURCE_ID_PATHS = [
  "$.transport.datapointBodies[*].body.source_ids[*]",
  "$.sourceBindingPlan[*].sourceId",
  "$.transport.biocharApplicationIntents[*].sourceIds[*]",
] as const;

// Every distinct Source id the given ledger rows' snapshots cite. Bounded by
// the rows named, not by the organization's mapping count.
async function listSourceIdsCitedBySubmissions(
  ctx: OrgContext,
  submissionIds: readonly string[],
  tx: DbTransaction,
): Promise<string[]> {
  const result = await tx.execute<{ source_id: string }>(sql`
    SELECT DISTINCT cited.value #>> '{}' AS source_id
    FROM ${certificationSubmissions}
    CROSS JOIN LATERAL (
      ${sql.join(
        SNAPSHOT_SOURCE_ID_PATHS.map(
          (path) =>
            sql`SELECT jsonb_path_query(${certificationSubmissions.payloadSnapshot}, ${path}::jsonpath) AS value`,
        ),
        sql` UNION ALL `,
      )}
    ) AS cited
    WHERE ${inArray(certificationSubmissions.id, [...submissionIds])}
      AND ${eq(certificationSubmissions.organizationId, ctx.organizationId)}
      AND jsonb_typeof(cited.value) = 'string'
  `);
  return result.rows.map((row) => row.source_id);
}

/**
 * Retire the local Isometric Source mappings that only the given ledger rows
 * still reference. Removal deletion calls this for the rows it is stamping
 * as deleted: a mapping those snapshots cite and no live snapshot does is
 * released so the owning record (an Application, a Delivery) can be deleted
 * afterwards. The remote Source is deliberately untouched, matching the
 * single-document delete; a later mirror of the same document reconciles
 * onto it through its `nm-src-{documentId}` supplier reference.
 *
 * Runs under the per-document mirror locks so a concurrent submit that is
 * reusing the mapping either finishes first (and its snapshot keeps the
 * mapping) or waits for this decision. The recheck after each delete guards
 * against a future submission entry point that forgets to take that lock.
 */
export async function releaseDocumentUploadsReferencedOnlyBySubmissions(
  ctx: OrgContext,
  submissionIds: readonly string[],
  tx: DbTransaction,
): Promise<ReleasedDocumentUpload[]> {
  requireOrgScope(ctx);
  if (submissionIds.length === 0) return [];

  const citedSourceIds = await listSourceIdsCitedBySubmissions(
    ctx,
    submissionIds,
    tx,
  );
  if (citedSourceIds.length === 0) return [];

  const candidates = await tx
    .select({
      documentId: certifierDocumentUploads.documentId,
      externalDocumentId: certifierDocumentUploads.externalDocumentId,
    })
    .from(certifierDocumentUploads)
    .where(
      and(
        eq(certifierDocumentUploads.provider, ISOMETRIC_PROVIDER),
        eq(certifierDocumentUploads.organizationId, ctx.organizationId),
        inArray(certifierDocumentUploads.externalDocumentId, citedSourceIds),
      ),
    )
    .orderBy(certifierDocumentUploads.documentId);
  if (candidates.length === 0) return [];

  await acquireMirrorLocksSorted(
    tx,
    candidates.map((row) => row.documentId),
  );

  const released: ReleasedDocumentUpload[] = [];
  for (const candidate of candidates) {
    const referencedElsewhere = () =>
      isExternalSourceReferencedInSnapshots(
        ctx,
        ISOMETRIC_PROVIDER,
        candidate.externalDocumentId,
        tx,
        { ignoreSubmissionIds: submissionIds },
      );
    if (await referencedElsewhere()) continue;
    await deleteDocumentUploadByDocument(
      ctx,
      ISOMETRIC_PROVIDER,
      candidate.documentId,
      tx,
    );
    if (await referencedElsewhere()) {
      throw new SafeError(SOURCE_RELEASE_RACE_ERROR);
    }
    released.push(candidate);
  }
  return released;
}
