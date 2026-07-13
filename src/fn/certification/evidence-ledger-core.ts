/**
 * Shared evidence-ledger generation core (transport + durability ledgers).
 *
 * Both evidence ledgers follow the SAME storage choreography — only the model
 * shape, renderer, document kind, and storage path differ. This module owns the
 * shared half: the per-removal serialization lock, the content-hash idempotency,
 * the reuse-or-render-or-retire decision, and the document → Source mirror. A
 * caller (`evidence-ledger.ts`, `durability-evidence-ledger.ts`) builds its pure
 * model, computes a stable content hash, and hands a `LedgerArtifactSpec` here.
 *
 * Idempotency / supersede (decided 2026-06-19): the ledger is content-hashed
 * over its model (NOT the rendered bytes, which carry a render timestamp).
 *   • identical content already mirrored → reuse the existing Source (no-op);
 *   • content changed (or never mirrored) → render a NEW document + Source, then
 *     RETIRE every prior ledger of the same kind for the removal so only the
 *     current one resolves into `source_ids`.
 * A retired ledger's registry Source is deliberately left on Isometric: it stays
 * immutable evidence for any already-submitted snapshot that referenced it. This
 * is why retirement is a direct local delete, not `unlinkDocumentSource` (whose
 * snapshot-reference guard would refuse). See docs/isometric/changes.md.
 *
 * Server-internal (no "use server" — takes an explicit `orgCtx`, called from the
 * submit pipeline which already resolved the caller).
 */
import type { OrgContext } from "@/lib/auth/server";
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
import { db } from "@/db";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { ISOMETRIC_PROVIDER } from "@/lib/isometric/utils/constants";
import type { logger } from "@/lib/log";
import { getStorageProvider } from "@/lib/storage";
import { mirrorDocumentToSourceForUser } from "./sources";

const PDF_MIME = "application/pdf";

export type LedgerLog = ReturnType<typeof logger.child>;

export type EnsureLedgerResult =
  | {
      status: "created" | "reused";
      documentId: string;
      externalSourceId: string;
      contentHash: string;
    }
  | { status: "skipped"; reason: string };

/**
 * Everything the shared core needs to materialise one ledger artifact. The
 * caller has already built + hashed its pure model; `render` is a thunk so the
 * (expensive) PDF render only runs on the content-changed path, inside the lock.
 */
export interface LedgerArtifactSpec {
  /** `documents.metadata.kind` tag — scopes prior-ledger lookup + supersede. */
  kind: string;
  removalId: string;
  facilityId: string;
  /** Member credit batch the document attaches to (candidate-doc walk finds it). */
  attachBatchId: string;
  /** Semantic fingerprint of the model (render timestamp excluded). */
  contentHash: string;
  /** True when the model has no content to evidence → retire priors + skip. */
  isEmpty: boolean;
  /** Skip reason returned when `isEmpty` (e.g. "no-legs" / "no-samples"). */
  emptyReason: string;
  /** Storage-key namespace, e.g. "transport-evidence" / "durability-evidence". */
  storageKeyPrefix: string;
  /** Document file name (human-facing). */
  fileName: string;
  /** Builds the JSON document metadata stored on the row (must carry kind + removalId). */
  buildMetadata: () => Record<string, unknown>;
  /** Renders the PDF bytes — called only when content changed. */
  render: () => Promise<Buffer>;
  log: LedgerLog;
}

export interface RetireLedgerSourcesSpec {
  kind: string;
  removalId: string;
  reason: string;
  log: LedgerLog;
}

/** Pin the render timestamp to a constant so identical models hash identically. */
export function stableLedgerContentHash<M extends { generatedAtIso: string }>(
  model: M,
): string {
  const stable = { ...model, generatedAtIso: "" };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function docContentHash(doc: DocumentRow): string | null {
  const meta = doc.metadata as Record<string, unknown> | null;
  return typeof meta?.contentHash === "string" ? meta.contentHash : null;
}

/**
 * Serializes ledger generation per removal. The transaction only scopes the
 * advisory lock; storage, mirror HTTP, and supersede deletes still use the
 * normal data-access functions. The flow is idempotent/self-healing rather than
 * atomic across those external effects.
 */
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
 * Generate (or reuse) one ledger artifact and mirror it to an Isometric Source.
 * Idempotent on `spec.contentHash`; supersedes any prior ledger of the same kind
 * for the removal. Throws on render/storage/mirror failure — the caller decides
 * whether a ledger hiccup should block submission (both current callers treat it
 * best-effort).
 */
export async function ensureLedgerSource(
  orgCtx: OrgContext,
  spec: LedgerArtifactSpec,
): Promise<EnsureLedgerResult> {
  return withRemovalLedgerSerialization(spec.removalId, async () => {
    const priors = await listDocumentsByKindForRemoval(
      orgCtx,
      spec.kind,
      spec.removalId,
    );

    if (spec.isEmpty) {
      // Nothing to evidence — drop any stale ledger so it stops riding into
      // source_ids, then skip.
      await retireSupersededLedgers(orgCtx, priors, null, spec.log);
      return { status: "skipped", reason: spec.emptyReason };
    }

    // Reuse path: a prior with identical content that's already mirrored.
    const sameContent = priors.find(
      (p) => docContentHash(p) === spec.contentHash,
    );
    if (sameContent) {
      const upload = await getDocumentUploadByDocument(
        orgCtx,
        ISOMETRIC_PROVIDER,
        sameContent.id,
      );
      if (upload) {
        await retireSupersededLedgers(orgCtx, priors, sameContent, spec.log);
        spec.log.info({ documentId: sameContent.id }, "reused evidence ledger");
        return {
          status: "reused",
          documentId: sameContent.id,
          externalSourceId: upload.externalDocumentId,
          contentHash: spec.contentHash,
        };
      }
    }

    // Render + store + insert a fresh ledger document. Past the reuse check the
    // priors are known-stale (their content hash differs from the current
    // model), so if any step here throws, retire them before propagating —
    // otherwise a stale ledger Source would still ride into `source_ids` while
    // the caller logs "submitting without it". On failure the submit then
    // carries NO ledger of this kind (honest with the log), and the next submit
    // regenerates it.
    try {
      const pdf = await spec.render();
      const provider = getStorageProvider();
      const storageKey = `org/${orgCtx.organizationId}/${spec.storageKeyPrefix}/${spec.facilityId}/${spec.removalId}/${spec.contentHash}.pdf`;
      await provider.putObject(storageKey, pdf, PDF_MIME);

      const doc = await insertDocument(orgCtx, {
        entityType: "credit_batch",
        entityId: spec.attachBatchId,
        documentType: "pdf",
        storageProvider: provider.name,
        storageBucket: provider.bucket,
        storageKey,
        fileName: spec.fileName,
        fileSizeBytes: pdf.byteLength,
        mimeType: PDF_MIME,
        checksumSha256: createHash("sha256").update(pdf).digest("hex"),
        visibility: "private",
        uploadStatus: "uploaded",
        capturedAt: new Date(),
        metadata: spec.buildMetadata(),
        createdBy: orgCtx.userId,
      });

      // Mirror to a Source (idempotent on documentId). The document sits on a
      // member credit batch, so the candidate-document lineage walk already
      // finds it → its Source rides into source_ids on submit with no extra
      // plumbing.
      const mirror = await mirrorDocumentToSourceForUser(orgCtx, {
        removalId: spec.removalId,
        documentId: doc.id,
        isPublic: false,
      });

      // Supersede: retire every prior ledger now that the current one is mirrored.
      await retireSupersededLedgers(orgCtx, priors, doc, spec.log);
      spec.log.info(
        { documentId: doc.id, retired: priors.length },
        "generated evidence ledger",
      );

      return {
        status: "created",
        documentId: doc.id,
        externalSourceId: mirror.externalDocumentId,
        contentHash: spec.contentHash,
      };
    } catch (err) {
      // Drop the stale priors so they can't masquerade as current evidence;
      // best-effort so a retirement hiccup doesn't mask the original failure.
      await retireSupersededLedgers(orgCtx, priors, null, spec.log).catch(
        (retireErr) => {
          spec.log.warn(
            {
              errorName:
                retireErr instanceof Error ? retireErr.name : typeof retireErr,
            },
            "failed to retire stale ledgers after generation error",
          );
        },
      );
      throw err;
    }
  });
}

/**
 * Retire every current ledger of one kind when the artifact no longer applies.
 * Kept as a first-class operation because some applicability checks (for
 * example durability tier and soil-reference presence) happen before a model
 * can be built and therefore cannot use `LedgerArtifactSpec.isEmpty`.
 */
export async function retireLedgerSources(
  orgCtx: OrgContext,
  spec: RetireLedgerSourcesSpec,
): Promise<EnsureLedgerResult> {
  return withRemovalLedgerSerialization(spec.removalId, async () => {
    const priors = await listDocumentsByKindForRemoval(
      orgCtx,
      spec.kind,
      spec.removalId,
    );
    await retireSupersededLedgers(orgCtx, priors, null, spec.log);
    return { status: "skipped", reason: spec.reason };
  });
}

/**
 * Retire every ledger in `priors` except `keep` (pass `null` to retire all).
 * Deletes the mirror mapping first (FK is RESTRICT), then the document row, then
 * best-effort the storage object — skipping the object when it's content-shared
 * with the kept document's key.
 */
async function retireSupersededLedgers(
  orgCtx: OrgContext,
  priors: DocumentRow[],
  keep: DocumentRow | null,
  log: LedgerLog,
): Promise<void> {
  const stale = priors.filter((p) => p.id !== keep?.id);
  if (stale.length === 0) return;

  const provider = getStorageProvider();
  await Promise.all(
    stale.map(async (doc) => {
      await deleteDocumentUploadByDocument(orgCtx, ISOMETRIC_PROVIDER, doc.id);
      await deleteDocumentRow(orgCtx, doc.id);
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
  log.info({ retired: stale.length }, "retired prior evidence ledgers");
}
