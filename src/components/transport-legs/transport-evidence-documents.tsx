"use client";

import { useState } from "react";
import {
  ArrowSquareOutIcon,
  FileIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatFileSize } from "@/lib/format-utils";
import {
  documentKeys,
  useDeleteDocument,
  useDocumentsForEntity,
} from "@/hooks/use-documents";
import type { DocumentEntityType } from "@/schemas/documents";
import { InfoHint } from "@/components/ui/tooltip";
import { isAcceptedDeliveryEvidenceDocument } from "@/lib/certification/delivery-evidence";
import { isAcceptedTransportEvidenceDocument } from "@/lib/certification/transport-evidence";
import {
  ClassifiedTransportEvidenceUploader,
  evidenceUploaderLabel,
} from "./classified-transport-evidence-uploader";

type TransportEvidenceEntityType = Extract<
  DocumentEntityType,
  "feedstock" | "delivery" | "transport_leg"
>;

const PANEL_HEADINGS: Record<TransportEvidenceEntityType, string> = {
  feedstock: "Transport evidence",
  transport_leg: "Transport evidence",
  delivery: "Delivery evidence",
};

const PANEL_HINTS: Record<TransportEvidenceEntityType, string> = {
  feedstock:
    "Optional. Attach a bill of lading, weigh-scale ticket, or other transport record if you have one.",
  transport_leg:
    "Optional. Attach a bill of lading, weigh-scale ticket, or other transport record if you have one.",
  delivery:
    "Optional. Attach a delivery receipt, bill of lading, photo, or other delivery record.",
};

const PANEL_EMPTY_TITLE: Record<TransportEvidenceEntityType, string> = {
  feedstock: "No transport evidence",
  transport_leg: "No transport evidence",
  delivery: "No delivery evidence",
};

function isAcceptedEvidenceDocument(
  entityType: TransportEvidenceEntityType,
  document: { uploadStatus: string; documentType: string },
): boolean {
  return entityType === "delivery"
    ? isAcceptedDeliveryEvidenceDocument(document)
    : isAcceptedTransportEvidenceDocument(document);
}

interface TransportEvidenceDocumentsProps {
  entityType: TransportEvidenceEntityType;
  entityId: string;
  readOnly?: boolean;
}

/**
 * Evidence upload + list for a stable lineage entity or a saved manual
 * transport leg. The document layer keeps the same evidence controls across
 * all three supported owners; deliveries add receipt and photo classifications.
 */
export function TransportEvidenceDocuments({
  entityType,
  entityId,
  readOnly = false,
}: TransportEvidenceDocumentsProps) {
  const toast = useToast();
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    entityType,
    entityId,
  );
  const invalidateKey = documentKeys.forEntity(entityType, entityId);
  const deleteMutation = useDeleteDocument(invalidateKey, { entityType });

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(deletingId);
      toast.success("Document deleted");
      setDeletingId(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Document was not deleted. Try again.",
      );
    }
  };

  const uploadedDocs = (docs ?? []).filter((doc) =>
    isAcceptedEvidenceDocument(entityType, doc),
  );

  return (
    <div className="flex flex-col gap-12">
      {error && (
        <ServerError
          message={
            error instanceof Error ? error.message : "The documents could not be loaded. Refresh the page and try again."
          }
        />
      )}
      {uploadError && <ServerError message={uploadError} />}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading documents…
        </p>
      ) : uploadedDocs.length > 0 ? (
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
                  {evidenceUploaderLabel(entityType, doc.documentType)} ·{" "}
                  {formatFileSize(doc.fileSizeBytes)}
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
                  disabled={deleteMutation.isPending}
                  className="shrink-0"
                  aria-label={`Delete ${doc.fileName}`}
                >
                  <TrashIcon size={16} weight="bold" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : readOnly ? (
        <EmptyState
          icon={<FileIcon size={32} weight="bold" />}
          title={PANEL_EMPTY_TITLE[entityType]}
          description="No documents are attached."
          padding="sm"
        />
      ) : null}

      {!readOnly && (
        <ClassifiedTransportEvidenceUploader
          id={`transport-evidence-${entityId}`}
          entityType={entityType}
          entityId={entityId}
          onUploadError={(message) => setUploadError(message || null)}
        />
      )}

      {deleteError && <ServerError message={deleteError} />}
      {!readOnly && (
        <DeleteConfirmDialog
          isOpen={!!deletingId}
          title="Delete Document"
          message="Are you sure you want to delete this document? The file will be removed from storage."
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            setDeletingId(null);
            setDeleteError(null);
          }}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

interface TransportEvidencePanelProps {
  entityType: TransportEvidenceEntityType;
  entityId: string;
  readOnly?: boolean;
  /** Omits repeated visible chrome when a parent section already supplies the heading. */
  embedded?: boolean;
}

/**
 * Composite evidence surface. Auto-derived transport stores documents on its
 * stable parent; manually managed transport stores them on the saved leg.
 */
export function TransportEvidencePanel({
  entityType,
  entityId,
  readOnly = false,
  embedded = false,
}: TransportEvidencePanelProps) {
  const heading = PANEL_HEADINGS[entityType];
  return (
    <section
      className={
        embedded
          ? "space-y-16"
          : "space-y-16 border-t border-[var(--color-border-tertiary)] pt-16"
      }
      aria-label={embedded ? heading : undefined}
    >
      <div className="flex items-center gap-6">
        {!embedded && (
          <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            {heading}
          </h3>
        )}
        <InfoHint label={`About ${heading.toLowerCase()}`}>
          {PANEL_HINTS[entityType]}
        </InfoHint>
      </div>
      <TransportEvidenceDocuments
        entityType={entityType}
        entityId={entityId}
        readOnly={readOnly}
      />
    </section>
  );
}
