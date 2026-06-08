"use client";

import { useState } from "react";
import { File, Trash, ArrowSquareOut } from "@phosphor-icons/react";
import { ServerError } from "@/components/forms";
import { FormField } from "@/components/forms/form-field";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatFileSize } from "@/lib/format-utils";
import {
  documentKeys,
  useDeleteDocument,
  useDocumentsForEntity,
} from "@/hooks/use-documents";
import type { DocumentEntityType, DocumentType } from "@/schemas/documents";

const ENTITY_TYPE: DocumentEntityType = "transport_leg";

// Transportation v1.1 §6 verification evidence — the two source documents the
// protocol calls for on a distance-based leg.
const EVIDENCE_FIELDS: { documentType: DocumentType; label: string }[] = [
  { documentType: "bill_of_lading", label: "Bill of lading" },
  { documentType: "weighbridge_ticket", label: "Weigh-scale ticket" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  bill_of_lading: "Bill of lading",
  weighbridge_ticket: "Weigh-scale ticket",
};

interface TransportLegDocumentsProps {
  legId: string;
}

/**
 * Evidence upload + list for a saved transport leg. Files attach to the leg via
 * the polymorphic documents layer (entityType "transport_leg"); the upload only
 * works once the leg exists, which is why the create form defers it ("attachable
 * later").
 */
export function TransportLegDocuments({ legId }: TransportLegDocumentsProps) {
  const toast = useToast();
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    ENTITY_TYPE,
    legId,
  );
  const invalidateKey = documentKeys.forEntity(ENTITY_TYPE, legId);
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
              <File
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
                <ArrowSquareOut size={16} weight="bold" />
              </a>
              <button
                type="button"
                onClick={() => setDeletingId(doc.id)}
                disabled={deleteMutation.isPending}
                className="shrink-0 p-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-signal-red)] transition-colors duration-300 disabled:opacity-50"
                aria-label={`Delete ${doc.fileName}`}
              >
                <Trash size={16} weight="bold" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-2 gap-16">
        {EVIDENCE_FIELDS.map(({ documentType, label }) => (
          <FormField key={documentType} id={`leg-${legId}-${documentType}`} label={label}>
            <FormFileUpload
              id={`leg-${legId}-${documentType}`}
              accept="image/*,.pdf"
              multiple={false}
              maxSizeMb={25}
              entityType={ENTITY_TYPE}
              entityId={legId}
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
