"use client";

import { useState } from "react";
import {
  ArrowSquareOutIcon,
  FileIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { FormField } from "@/components/forms/form-field";
import { FormFileUpload } from "@/components/forms/form-file-upload";
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

type TransportEvidenceEntityType = Extract<
  DocumentEntityType,
  "feedstock" | "delivery" | "transport_leg"
>;

// The two transportation-evidence document types currently modelled by noma.
// This is not an exhaustive statement of the protocol's evidence requirements.
const EVIDENCE_FIELDS: { documentType: DocumentType; label: string }[] = [
  { documentType: "bill_of_lading", label: "Bill of lading" },
  { documentType: "weighbridge_ticket", label: "Weigh-scale ticket" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  bill_of_lading: "Bill of lading",
  weighbridge_ticket: "Weigh-scale ticket",
};

interface TransportEvidenceDocumentsProps {
  entityType: TransportEvidenceEntityType;
  entityId: string;
}

/**
 * Transport evidence upload + list for a stable lineage entity or a saved
 * manual transport leg. The document layer keeps the same evidence controls
 * across all three supported owners.
 */
export function TransportEvidenceDocuments({
  entityType,
  entityId,
}: TransportEvidenceDocumentsProps) {
  const toast = useToast();
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    entityType,
    entityId,
  );
  const invalidateKey = documentKeys.forEntity(entityType, entityId);
  const deleteMutation = useDeleteDocument(invalidateKey);

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
        err instanceof Error ? err.message : "Failed to delete document",
      );
    }
  };

  const uploadedDocs = (docs ?? []).filter(
    (d) => d.uploadStatus === "uploaded" || d.fileUrl,
  );

  return (
    <div className="flex flex-col gap-12">
      {error && (
        <ServerError
          message={
            error instanceof Error ? error.message : "Failed to load documents"
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
                  {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType} ·{" "}
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
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
        {EVIDENCE_FIELDS.map(({ documentType, label }) => (
          <FormField
            key={documentType}
            id={`transport-evidence-${entityId}-${documentType}`}
            label={label}
          >
            <FormFileUpload
              id={`transport-evidence-${entityId}-${documentType}`}
              accept="image/*,.pdf"
              multiple={false}
              maxSizeMb={25}
              entityType={entityType}
              entityId={entityId}
              documentType={documentType}
              onUploaded={() => {
                setUploadError(null);
                toast.success(`${label} uploaded`);
              }}
              onUploadError={(err) => setUploadError(err)}
            />
          </FormField>
        ))}
      </div>

      {deleteError && <ServerError message={deleteError} />}
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
    </div>
  );
}

interface TransportEvidencePanelProps {
  entityType: Exclude<TransportEvidenceEntityType, "transport_leg">;
  entityId: string;
}

/**
 * Attachment-only evidence surface for auto-derived transport. Documents stay
 * on the stable parent entity, so a leg recalculation cannot orphan them.
 */
export function TransportEvidencePanel({
  entityType,
  entityId,
}: TransportEvidencePanelProps) {
  return (
    <section className="space-y-16 border-t border-[var(--color-border-tertiary)] pt-16">
      <div className="space-y-6">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Transport evidence
        </h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          Attach the bill of lading and weigh-scale ticket used to support this
          journey. Uploaded files become Source candidates; mirror them from the
          Removal&apos;s Supporting Sources panel before submission. These are the
          document types currently supported here; the active module may require
          additional journey evidence.
        </p>
      </div>
      <TransportEvidenceDocuments
        entityType={entityType}
        entityId={entityId}
      />
    </section>
  );
}
