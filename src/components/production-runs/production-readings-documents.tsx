"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  FileIcon,
  TrashIcon,
  ArrowSquareOutIcon,
  ArrowClockwiseIcon,
} from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatFileSize } from "@/lib/format-utils";
import {
  documentKeys,
  useDeleteDocument,
  useDocumentsForEntity,
} from "@/hooks/use-documents";
import { useImportProductionRunReadings } from "@/hooks/use-production-run-reading-imports";
import type { ProductionRunReadingsImportResult } from "@/fn/production-run-reading-imports";
import type { DocumentEntityType, DocumentType } from "@/schemas/documents";
import type {
  DeferredAttachment,
  UseDeferredAttachmentsResult,
} from "@/hooks/use-deferred-attachments";

interface ProductionReadingsDocumentsProps {
  productionRunId?: string;
  /** View mode hides the upload control and delete actions. */
  readOnly?: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
  disabled?: boolean;
}

const READINGS_DOC_TYPE: DocumentType = "sensor_data";
const ENTITY_TYPE: DocumentEntityType = "production_run";
const READINGS_ACCEPT = ".csv";
const READINGS_MAX_MB = 25;

/** One human-readable summary line for a completed import. */
function importSummary(result: ProductionRunReadingsImportResult): string {
  const parts = [`${result.droppedRows} outside run window`];
  if (result.duplicateRows > 0) {
    parts.push(`${result.duplicateRows} already imported`);
  }
  if (result.intraFileDuplicateRows > 0) {
    parts.push(`${result.intraFileDuplicateRows} duplicate rows in file`);
  }
  if (result.skippedRows > 0) parts.push(`${result.skippedRows} skipped`);
  if (result.invalidRequiredRows > 0) {
    parts.push(`${result.invalidRequiredRows} missing temperature/pressure`);
  }
  return `Imported ${result.insertedRows} readings (${parts.join(", ")})`;
}

/** Reads the durable import status the fn writes to `metadata.readingsImport`. */
function readingsImportFailed(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const imp = (metadata as Record<string, unknown>).readingsImport;
  if (!imp || typeof imp !== "object") return false;
  return (imp as Record<string, unknown>).status === "failed";
}

/**
 * Readings CSV upload + file list for a production run, persisted as
 * `sensor_data` documents through the real presigned storage flow
 * (local-fs in dev, S3-compatible when configured). Uploading a canonical
 * readings CSV (see `@/lib/production-readings/readings-csv`) imports its
 * rows straight into the production readings table — columns are matched by
 * header, so there is no channel-alignment step.
 */
export function ProductionReadingsDocuments({
  productionRunId,
  readOnly = false,
  deferredAttachments,
  disabled = false,
}: ProductionReadingsDocumentsProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    ENTITY_TYPE,
    productionRunId,
  );
  const invalidateKey = productionRunId
    ? documentKeys.forEntity(ENTITY_TYPE, productionRunId)
    : undefined;
  const deleteMutation = useDeleteDocument(invalidateKey);
  const importReadings = useImportProductionRunReadings();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const runImport = (documentId: string) => {
    setUploadError(null);
    void (async () => {
      try {
        const result = await importReadings.mutateAsync(documentId);
        toast.success(importSummary(result));
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to import readings",
        );
      } finally {
        // The import writes its outcome to the document's metadata; refetch so a
        // failed import surfaces the "Re-import" affordance (and a recovered one
        // clears it).
        void queryClient.invalidateQueries({ queryKey: invalidateKey });
      }
    })();
  };

  // Retrying a failed deferred upload re-attaches the CSV as a document but does
  // not import its rows — mirror the create path (production-run-list) and run
  // the same per-doc import so the readings land instead of silently vanishing.
  // A failed import writes its durable flag via runImport, surfacing Re-import.
  const importUploadedReadings = (uploaded: DeferredAttachment[]) => {
    for (const attachment of uploaded) {
      if (attachment.documentType === READINGS_DOC_TYPE && attachment.documentId) {
        runImport(attachment.documentId);
      }
    }
  };

  const handleDeferredRetry = async (key?: string) => {
    if (!deferredAttachments || !productionRunId) return;
    const result = await deferredAttachments.retry(
      ENTITY_TYPE,
      [productionRunId],
      key,
    );
    importUploadedReadings(result.uploaded);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(deletingId);
      toast.success("Readings file deleted");
      setDeletingId(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete file",
      );
    }
  };

  const uploadedDocs = (docs ?? []).filter(
    (d) =>
      d.documentType === READINGS_DOC_TYPE &&
      (d.uploadStatus === "uploaded" || d.fileUrl),
  );

  if (!productionRunId) {
    return (
      <FormFileUpload
        id="production-run-deferred-readings-upload"
        accept={READINGS_ACCEPT}
        multiple={false}
        maxSizeMb={READINGS_MAX_MB}
        disabled={disabled}
        deferred
        deferredFiles={deferredAttachments?.attachments ?? []}
        onDeferredAdd={(files) =>
          deferredAttachments?.add(files, READINGS_DOC_TYPE)
        }
        onDeferredRemove={(key) => deferredAttachments?.remove(key)}
      />
    );
  }

  return (
    <section className="flex flex-col gap-12">
      {deferredAttachments && (
        <FailedDeferredAttachments
          attachments={deferredAttachments.attachments}
          onRetry={handleDeferredRetry}
          onRemove={deferredAttachments.remove}
          disabled={disabled}
        />
      )}
      <header className="flex items-center justify-between">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {uploadedDocs.length} {uploadedDocs.length === 1 ? "file" : "files"}
        </span>
      </header>

      {error && (
        <ServerError
          message={
            error instanceof Error ? error.message : "Failed to load files"
          }
        />
      )}
      {uploadError && <ServerError message={uploadError} />}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          Loading files…
        </p>
      ) : uploadedDocs.length === 0 ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          No readings files uploaded yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-8">
          {uploadedDocs.map((doc) => {
            const importFailed = readingsImportFailed(doc.metadata);
            return (
            <li
              key={doc.id}
              className="flex items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
            >
              <FileIcon
                size={16}
                weight="bold"
                className="shrink-0 text-[var(--color-text-tertiary)]"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="body-small truncate text-[var(--color-text-primary)]">
                  {doc.fileName}
                </span>
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  Readings CSV · {formatFileSize(doc.fileSizeBytes)}
                  {importFailed && (
                    <>
                      {" · "}
                      <span className="text-[var(--color-status-error)]">
                        Import failed
                      </span>
                    </>
                  )}
                </span>
              </div>
              {!readOnly && importFailed && (
                <Button
                  variant="weak"
                  size="small"
                  onClick={() => runImport(doc.id)}
                  disabled={importReadings.isPending}
                  className="shrink-0"
                >
                  <ArrowClockwiseIcon size={14} weight="bold" />
                  Re-import
                </Button>
              )}
              <a
                href={`/api/documents/${doc.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 p-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-interaction)] transition-colors duration-300"
                aria-label={`Open ${doc.fileName}`}
              >
                <ArrowSquareOutIcon size={16} weight="bold" />
              </a>
              {!readOnly && (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setDeletingId(doc.id)}
                  disabled={deleteMutation.isPending}
                  className="shrink-0"
                  aria-label={`Delete ${doc.fileName}`}
                >
                  <TrashIcon size={16} weight="bold" />
                </Button>
              )}
            </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <FormFileUpload
          id={`production-run-${productionRunId}-readings-upload`}
          accept={READINGS_ACCEPT}
          // One file per selection: every upload inserts new readings and skips
          // any (run, timestamp) already imported, so a re-run is idempotent.
          multiple={false}
          maxSizeMb={READINGS_MAX_MB}
          disabled={disabled || importReadings.isPending}
          entityType={ENTITY_TYPE}
          entityId={productionRunId}
          documentType={READINGS_DOC_TYPE}
          onUploaded={runImport}
          onUploadError={(err) => setUploadError(err)}
        />
      )}

      {deleteError && <ServerError message={deleteError} />}
      <DeleteConfirmDialog
        isOpen={!!deletingId}
        title="Delete Readings File"
        message="Are you sure you want to delete this readings file? The file will be removed from storage."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingId(null);
          setDeleteError(null);
        }}
        isPending={deleteMutation.isPending}
      />
    </section>
  );
}
