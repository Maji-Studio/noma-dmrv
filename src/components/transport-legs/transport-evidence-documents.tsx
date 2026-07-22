"use client";

import { useState } from "react";
import {
  ArrowSquareOutIcon,
  FileIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatFileSize } from "@/lib/format-utils";
import {
  documentKeys,
  useDeleteDocument,
  useDocumentsForEntity,
} from "@/hooks/use-documents";
import type { DocumentEntityType } from "@/schemas/documents";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import { InfoHint } from "@/components/ui/tooltip";
import {
  isAcceptedTransportEvidenceDocument,
  deriveTransportEvidenceCertStatus,
  isTransportEvidenceDocumentType,
  TRANSPORT_EVIDENCE_DOCUMENT_LABELS,
} from "@/lib/certification/transport-evidence";
import { ClassifiedTransportEvidenceUploader } from "./classified-transport-evidence-uploader";

type TransportEvidenceEntityType = Extract<
  DocumentEntityType,
  "feedstock" | "delivery" | "transport_leg"
>;

interface TransportEvidenceDocumentsProps {
  entityType: TransportEvidenceEntityType;
  entityId: string;
  readOnly?: boolean;
}

/**
 * Transport evidence upload + list for a stable lineage entity or a saved
 * manual transport leg. The document layer keeps the same evidence controls
 * across all three supported owners.
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
        err instanceof Error ? err.message : "Failed to delete document",
      );
    }
  };

  const uploadedDocs = (docs ?? []).filter(
    isAcceptedTransportEvidenceDocument,
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
                  {isTransportEvidenceDocumentType(doc.documentType)
                    ? TRANSPORT_EVIDENCE_DOCUMENT_LABELS[doc.documentType]
                    : doc.documentType} ·{" "}
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
        <p className="body-small text-[var(--color-text-secondary)]">
          No transport evidence attached.
        </p>
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
  /** Effective saved provenance of the distance represented by this surface. */
  distanceSource?: DistanceSourceValue | null;
  /** Undefined while saved provenance is still loading. */
  persisted?: boolean;
}

/**
 * Composite evidence surface. Auto-derived transport stores documents on its
 * stable parent; manually managed transport stores them on the saved leg.
 */
export function TransportEvidencePanel({
  entityType,
  entityId,
  readOnly = false,
  distanceSource,
  persisted = true,
}: TransportEvidencePanelProps) {
  const { data: documents } = useDocumentsForEntity(entityType, entityId);
  const acceptedDocumentCount = documents?.filter(
    isAcceptedTransportEvidenceDocument,
  ).length;
  const evidenceStatus = deriveTransportEvidenceCertStatus({
    persisted,
    documentsLoaded: documents !== undefined,
    source: distanceSource,
    acceptedDocumentCount,
  });
  return (
    <section className="space-y-16 border-t border-[var(--color-border-tertiary)] pt-16">
      <div className="flex items-center gap-6">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Transport evidence
        </h3>
        <CertificationFieldTag
          status={evidenceStatus}
          description="Satisfied when saved provenance is Document and at least one classified file is uploaded"
        />
        <InfoHint label="About transport evidence">
          Transport evidence requires saved Document provenance plus at least
          one uploaded bill of lading, weigh-scale ticket, or other transport
          evidence file. One accepted file is enough. Uploading does not change
          the saved provenance.
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
