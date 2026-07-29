"use client";

import { useState } from "react";
import {
  FileIcon,
  TrashIcon,
  ArrowSquareOutIcon,
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
import type { DocumentEntityType, DocumentType } from "@/schemas/documents";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";

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

/**
 * Readings-file upload + file list for a production run. CSVs are persisted
 * unchanged as `sensor_data` documents through the normal presigned storage
 * flow (local-fs in dev, S3-compatible when configured). This operator surface
 * does not inspect the file contents or import row-level readings.
 */
export function ProductionReadingsDocuments({
  productionRunId,
  readOnly = false,
  deferredAttachments,
  disabled = false,
}: ProductionReadingsDocumentsProps) {
  const toast = useToast();
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    ENTITY_TYPE,
    productionRunId,
  );
  const invalidateKey = productionRunId
    ? documentKeys.forEntity(ENTITY_TYPE, productionRunId)
    : undefined;
  const deleteMutation = useDeleteDocument(invalidateKey);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleDeferredRetry = async (key?: string) => {
    if (!deferredAttachments || !productionRunId) return;
    await deferredAttachments.retry(
      ENTITY_TYPE,
      [productionRunId],
      key,
    );
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
        err instanceof Error ? err.message : "The file was not deleted. Try again.",
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
            error instanceof Error ? error.message : "The files could not be loaded. Refresh the page and try again."
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
          {uploadedDocs.map((doc) => (
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
                </span>
              </div>
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
                  disabled={disabled || deleteMutation.isPending}
                  className="shrink-0"
                  aria-label={`Delete ${doc.fileName}`}
                >
                  <TrashIcon size={16} weight="bold" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <FormFileUpload
          id={`production-run-${productionRunId}-readings-upload`}
          accept={READINGS_ACCEPT}
          multiple={false}
          maxSizeMb={READINGS_MAX_MB}
          disabled={disabled}
          entityType={ENTITY_TYPE}
          entityId={productionRunId}
          documentType={READINGS_DOC_TYPE}
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
