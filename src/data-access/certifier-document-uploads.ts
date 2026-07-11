import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { certifierDocumentUploads } from "@/db/schema/certification";
import { certificationSubmissions } from "@/db/schema/certification";
import { documents } from "@/db/schema/documentation";
import type { OrgContext } from "@/lib/auth/server";
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

export async function updateDocumentUploadMetadata(
  ctx: OrgContext,
  rowId: string,
  metadata: DocumentUploadMetadata,
  txOrDb: DbClient = db,
): Promise<CertifierDocumentUploadRow> {
  requireOrgScope(ctx);
  const [row] = await txOrDb
    .update(certifierDocumentUploads)
    .set({
      metadata: metadata as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(and(eq(certifierDocumentUploads.id, rowId), eq(certifierDocumentUploads.organizationId, ctx.organizationId)))
    .returning();
  if (!row) {
    throw new Error(`Document upload ${rowId} not found`);
  }
  return row;
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

// Checks whether any persisted submission payload references the given
// Isometric Source id. Used as the unlink-safety guard: if a Source landed in
// any `payloadSnapshot.transport.datapointBodies[].body.source_ids`, the
// local mapping cannot be deleted without orphaning the audit trail. Scans
// every status because rejected/superseded snapshots are still real history.
//
// jsonb_path_exists is the canonical Postgres idiom for "any element of any
// nested array equals X"; using `@>` containment is awkward across nested
// arrays.
export async function isExternalSourceReferencedInSnapshots(
  ctx: OrgContext,
  provider: CertifierProvider,
  externalDocumentId: string,
  txOrDb: DbClient = db,
): Promise<boolean> {
  requireOrgScope(ctx);
  // Provider scoping is forward-compat: only `isometric` issues source_ids
  // today, but the enum permits `puro_earth` / `verra` and nothing
  // structurally prevents two providers from generating the same source_id
  // string. Without this filter, unlink on provider A could refuse because
  // provider B's payload mentioned the same id.
  // The explicit ::text cast on $val is required: without it, Postgres
  // raises `42P18 — could not determine data type of parameter` because
  // jsonb_build_object accepts any, and the planner can't infer the type
  // from context.
  const result = await txOrDb.execute<{ found: number }>(sql`
    SELECT 1 AS found
    FROM ${certificationSubmissions}
    WHERE ${eq(certificationSubmissions.provider, provider)}
      AND ${eq(certificationSubmissions.organizationId, ctx.organizationId)}
      AND jsonb_path_exists(
        payload_snapshot,
        '$.transport.datapointBodies[*].body.source_ids[*] ? (@ == $val)',
        jsonb_build_object('val', ${externalDocumentId}::text)
      )
    LIMIT 1
  `);
  return result.rows.length > 0;
}
