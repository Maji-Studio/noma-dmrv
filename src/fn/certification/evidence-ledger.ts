/**
 * Transport evidence-ledger generation, storage, and Source mirroring.
 *
 * Server-internal core (no "use server" — it takes an explicit `userId` and is
 * called from the submit pipeline, which already resolved the caller). On every
 * Submit/Resubmit, `ensureTransportEvidenceLedgerSource` regenerates the ledger
 * from the removal's live transport legs, stores it, attaches it as a private
 * document on a member credit batch, and mirrors it to an Isometric Source so it
 * rides into the removal's `source_ids`.
 *
 * Idempotency / supersede (decided 2026-06-19): the ledger is content-hashed
 * over its legs/totals (NOT the rendered bytes, which carry a render timestamp).
 *   • identical content already mirrored → reuse the existing Source (no-op);
 *   • content changed (or never mirrored) → render a NEW document + Source, then
 *     RETIRE every prior ledger for the removal so only the current one resolves
 *     into `source_ids`.
 * A retired ledger's registry Source is deliberately left on Isometric: it stays
 * immutable evidence for any already-submitted snapshot that referenced it. This
 * is why retirement is a direct local delete, not `unlinkDocumentSource` (whose
 * snapshot-reference guard would refuse). See docs/isometric/changes.md.
 */
import { createHash } from "node:crypto";
import {
  deleteDocumentUploadByDocument,
  getDocumentUploadByDocument,
} from "@/data-access/certifier-document-uploads";
import {
  deleteDocumentRow,
  insertDocument,
  listDocumentsByKindForRemoval,
  type DocumentRow,
} from "@/data-access/documents";
import { getFacilityById } from "@/data-access/facilities";
import { db } from "@/db";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { buildLedgerModel } from "@/lib/certification/evidence-ledger/build-model";
import { renderEvidenceLedgerPdf } from "@/lib/certification/evidence-ledger/pdf";
import {
  TRANSPORT_EVIDENCE_LEDGER_KIND,
  type LedgerModel,
  type TransportEvidenceLedgerDocMetadata,
} from "@/lib/certification/evidence-ledger/types";
import { ISOMETRIC_PROVIDER } from "@/lib/isometric/utils/constants";
import { logger } from "@/lib/log";
import { getStorageProvider } from "@/lib/storage";
import {
  loadRemovalSubmissionContext,
  type RemovalSubmissionContext,
} from "./certify-context-core";
import { mirrorDocumentToSourceForUser } from "./sources";

const PDF_MIME = "application/pdf";

export type EnsureLedgerResult =
  | {
      status: "created" | "reused";
      documentId: string;
      externalSourceId: string;
      contentHash: string;
    }
  | { status: "skipped"; reason: "no-mapping" | "no-batches" | "no-legs" };

/**
 * Semantic fingerprint of a ledger: everything that's visible EXCEPT the render
 * timestamp, so re-rendering identical legs yields the same hash (and reuses the
 * same Source instead of accumulating one per submit).
 */
function ledgerContentHash(model: LedgerModel): string {
  // Pin the render timestamp to a constant so identical legs hash identically.
  const stable = { ...model, generatedAtIso: "" };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function docContentHash(doc: DocumentRow): string | null {
  const meta = doc.metadata as Record<string, unknown> | null;
  return typeof meta?.contentHash === "string" ? meta.contentHash : null;
}

// Serializes ledger generation per removal. The transaction only scopes the
// advisory lock; storage, mirror HTTP, and supersede deletes still use the
// normal data-access functions. The flow is idempotent/self-healing rather than
// atomic across those external effects.
async function withRemovalLedgerSerialization<T>(
  removalId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await acquireCertificationArtifactLocksSorted(tx, [
      {
        provider: ISOMETRIC_PROVIDER,
        localEntityType: "removal",
        localEntityId: removalId,
      },
    ]);

    return fn();
  });
}

/**
 * Generate (or reuse) the transport evidence ledger for a removal, store it, and
 * mirror it to an Isometric Source. Loads the submission context, then delegates
 * to the from-context variant. Use this for standalone callers (e.g. a manual
 * regenerate); the submit pipeline already holds a context and should call
 * `ensureTransportEvidenceLedgerSourceFromContext` to avoid a second load.
 */
export async function ensureTransportEvidenceLedgerSource(
  userId: string,
  removalId: string,
): Promise<EnsureLedgerResult> {
  const ctx = await loadRemovalSubmissionContext(userId, removalId);
  return ensureTransportEvidenceLedgerSourceFromContext(userId, removalId, ctx);
}

/**
 * As above, but against an already-loaded submission context. Idempotent on
 * ledger content; supersedes any prior ledger for the removal. Throws on
 * render/storage/mirror failure — the caller decides whether a ledger hiccup
 * should block submission.
 */
export async function ensureTransportEvidenceLedgerSourceFromContext(
  userId: string,
  removalId: string,
  ctx: RemovalSubmissionContext,
): Promise<EnsureLedgerResult> {
  const log = logger.child({ op: "removal:evidence-ledger", removalId });

  if (!ctx.mapping) {
    // No Isometric project linked → nothing to mirror into.
    return { status: "skipped", reason: "no-mapping" };
  }
  if (ctx.memberBatches.length === 0) {
    // No credit batch to attach the document to.
    return { status: "skipped", reason: "no-batches" };
  }

  const facility = await getFacilityById(userId, ctx.facilityId);
  const memberBatchCodes =
    ctx.memberBatches.map((b) => b.code).join(" · ") || null;

  const model = buildLedgerModel({
    legsByCategory: ctx.transportLegs,
    memberBatchCodes,
    facilityName: facility?.name ?? null,
    externalProjectId: ctx.mapping.externalProjectId,
    generatedAtIso: new Date().toISOString(),
  });

  return withRemovalLedgerSerialization(removalId, () =>
    ensureTransportEvidenceLedgerSourceForModel(userId, removalId, ctx, model, log),
  );
}

async function ensureTransportEvidenceLedgerSourceForModel(
  userId: string,
  removalId: string,
  ctx: RemovalSubmissionContext,
  model: LedgerModel,
  log: ReturnType<typeof logger.child>,
): Promise<EnsureLedgerResult> {
  const priors = await listDocumentsByKindForRemoval(
    userId,
    TRANSPORT_EVIDENCE_LEDGER_KIND,
    removalId,
  );

  if (model.totalLegs === 0) {
    // Legs removed entirely — no transport to evidence. Drop any stale ledger so
    // it doesn't keep riding into source_ids.
    await retireSupersededLedgers(userId, priors, null, log);
    return { status: "skipped", reason: "no-legs" };
  }

  const contentHash = ledgerContentHash(model);

  // Reuse path: a prior with identical content that's already mirrored.
  const sameContent = priors.find((p) => docContentHash(p) === contentHash);
  if (sameContent) {
    const upload = await getDocumentUploadByDocument(
      userId,
      ISOMETRIC_PROVIDER,
      sameContent.id,
    );
    if (upload) {
      await retireSupersededLedgers(userId, priors, sameContent, log);
      log.info({ documentId: sameContent.id }, "reused transport evidence ledger");
      return {
        status: "reused",
        documentId: sameContent.id,
        externalSourceId: upload.externalDocumentId,
        contentHash,
      };
    }
  }

  // Render + store + insert a fresh ledger document.
  const pdf = await renderEvidenceLedgerPdf(model);
  const provider = getStorageProvider();
  const storageKey = `transport-evidence/${ctx.facilityId}/${removalId}/${contentHash}.pdf`;
  await provider.putObject(storageKey, pdf, PDF_MIME);

  const metadata: TransportEvidenceLedgerDocMetadata = {
    kind: TRANSPORT_EVIDENCE_LEDGER_KIND,
    removalId,
    contentHash,
  };
  const doc = await insertDocument(userId, {
    entityType: "credit_batch",
    entityId: ctx.memberBatches[0].id,
    documentType: "pdf",
    storageProvider: provider.name,
    storageBucket: provider.bucket,
    storageKey,
    fileName: `transport-evidence-ledger-${model.memberBatchCodes ?? removalId}.pdf`,
    fileSizeBytes: pdf.byteLength,
    mimeType: PDF_MIME,
    checksumSha256: createHash("sha256").update(pdf).digest("hex"),
    visibility: "private",
    uploadStatus: "uploaded",
    capturedAt: new Date(),
    metadata: metadata as unknown as Record<string, unknown>,
    createdBy: userId,
  });

  // Mirror to a Source (idempotent on documentId). The document sits on a member
  // credit batch, so the candidate-document lineage walk already finds it → its
  // Source rides into source_ids on submit with no extra plumbing.
  const mirror = await mirrorDocumentToSourceForUser(userId, {
    removalId,
    documentId: doc.id,
    isPublic: false,
  });

  // Supersede: retire every prior ledger now that the current one is mirrored.
  await retireSupersededLedgers(userId, priors, doc, log);
  log.info(
    { documentId: doc.id, legs: model.totalLegs, retired: priors.length },
    "generated transport evidence ledger",
  );

  return {
    status: "created",
    documentId: doc.id,
    externalSourceId: mirror.externalDocumentId,
    contentHash,
  };
}

/**
 * Retire every ledger in `priors` except `keep` (pass `null` to retire all).
 * Deletes the mirror mapping first (FK is RESTRICT), then the document row, then
 * best-effort the storage object — skipping the object when it's content-shared
 * with the kept document's key.
 */
async function retireSupersededLedgers(
  userId: string,
  priors: DocumentRow[],
  keep: DocumentRow | null,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  const stale = priors.filter((p) => p.id !== keep?.id);
  if (stale.length === 0) return;

  const provider = getStorageProvider();
  await Promise.all(
    stale.map(async (doc) => {
      await deleteDocumentUploadByDocument(userId, ISOMETRIC_PROVIDER, doc.id);
      await deleteDocumentRow(userId, doc.id);
      if (doc.storageKey && doc.storageKey !== keep?.storageKey) {
        // Orphaned bytes are harmless (the row + mapping are gone, so it can
        // never re-enter source_ids); a delete failure must not fail the submit.
        await provider.deleteObject(doc.storageKey).catch((err) => {
          log.warn(
            {
              documentId: doc.id,
              errorName: err instanceof Error ? err.name : typeof err,
            },
            "failed to delete retired ledger object",
          );
        });
      }
    }),
  );
  log.info({ retired: stale.length }, "retired prior transport evidence ledgers");
}
