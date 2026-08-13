"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowSquareOutIcon,
  FileIcon,
  MapTrifoldIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { FormFileUpload, ServerError } from "@/components/forms";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EmptyState } from "@/components/ui";
import { InfoHint } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import type { DocumentRow } from "@/data-access/documents";
import { applicationKeys } from "@/hooks/use-applications";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import {
  documentKeys,
  useDeleteDocument,
  useDocumentsForEntity,
} from "@/hooks/use-documents";
import {
  APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE,
  APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS,
  isApplicationVisualEvidenceRole,
} from "@/lib/certification/application-evidence";
import { formatDate, formatFileSize } from "@/lib/format-utils";
import type {
  ApplicationEvidenceMethod,
} from "@/schemas/applications";
import type { DocumentEntityType, DocumentType } from "@/schemas/documents";
import type { GisBoundary } from "@/schemas/gis-boundary";
import { GisReferenceDialog } from "./gis-reference-dialog";
import { GisReferenceSummary } from "./gis-reference-summary";
import { RadioCardGroup } from "./radio-card-group";

const ENTITY_TYPE = "application" satisfies DocumentEntityType;
const LOGBOOK_DOC_TYPE: DocumentType = "pdf";
const GIS_BOUNDARY_DOC_TYPE: DocumentType = "gis_boundary";

const METHOD_OPTIONS = [
  {
    key: "location",
    title: "Customer location",
    description:
      "Use the application GPS coordinates from the delivery's customer location.",
  },
  {
    key: "boundary",
    title: "GIS reference",
    description: "The field boundary as a GeoJSON file, drawn on a map.",
  },
  {
    key: "visual",
    title: "Visual evidence",
    description: "Geotagged photos of each application stage.",
    disabled: true,
    badge: "Available later",
  },
] as const;

interface ApplicationEvidencePanelProps {
  applicationId?: string;
  mode: ApplicationEvidenceMethod;
  boundary: GisBoundary | null;
  disabled?: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
  readOnly?: boolean;
  onModeChange?: (mode: ApplicationEvidenceMethod) => void;
  onBoundaryChange?: (boundary: GisBoundary | null) => void;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function isUploadedDocument(doc: DocumentRow): boolean {
  return doc.uploadStatus === "uploaded" || doc.fileUrl != null;
}

function isLogbookDocument(doc: DocumentRow): boolean {
  return (
    doc.documentType === LOGBOOK_DOC_TYPE ||
    doc.documentType === "weighbridge_ticket" ||
    doc.documentType === "affidavit"
  );
}

function isRetainedEvidenceDocument(doc: DocumentRow): boolean {
  return (
    isLogbookDocument(doc) ||
    doc.documentType === GIS_BOUNDARY_DOC_TYPE ||
    doc.documentType === APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE
  );
}

function EvidenceDocumentList({
  docs,
  disabled,
  deleteMutationPending,
  onDelete,
}: {
  docs: DocumentRow[];
  disabled: boolean;
  deleteMutationPending: boolean;
  onDelete?: (id: string) => void;
}) {
  if (docs.length === 0) {
    return (
      <p className="body-small text-[var(--color-text-secondary)]">
        No retained files attached yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-8">
      {docs.map((doc) => {
        const evidenceRoleValue = metadataRecord(doc.metadata).evidenceRole;
        const evidenceRole = isApplicationVisualEvidenceRole(evidenceRoleValue)
          ? evidenceRoleValue
          : null;
        const missingExifValue = metadataRecord(doc.metadata).missingExif;
        const missingExif =
          Array.isArray(missingExifValue) && missingExifValue.length > 0
            ? missingExifValue
                .filter((item) => typeof item === "string")
                .join(", ")
            : null;
        return (
          <li
            key={doc.id}
            className="flex flex-wrap items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
          >
            <FileIcon
              size={16}
              weight="bold"
              className="shrink-0 text-[var(--color-text-tertiary)]"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="body-small truncate text-[var(--color-text-primary)]">
                {doc.fileName}
              </span>
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {formatFileSize(doc.fileSizeBytes)}
                {doc.capturedAt ? ` · ${formatDate(doc.capturedAt)}` : ""}
                {evidenceRole
                  ? ` · ${APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS[evidenceRole]}`
                  : ""}
              </span>
              {missingExif && (
                <span className="inline-flex items-center gap-4 body-caption text-[var(--color-signal-orange-strong)]">
                  <WarningCircleIcon size={14} weight="bold" />
                  No geotag: {missingExif}
                </span>
              )}
            </div>
            <a
              href={`/api/documents/${doc.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-4 text-[var(--color-text-tertiary)] transition-colors duration-300 hover:text-[var(--color-interaction)]"
              aria-label={`Open ${doc.fileName}`}
            >
              <ArrowSquareOutIcon size={16} weight="bold" />
            </a>
            {onDelete && (
              <Button
                variant="destructive"
                size="icon"
                onClick={() => onDelete(doc.id)}
                disabled={deleteMutationPending || disabled}
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
  );
}

function GisReferenceField({
  boundary,
  disabled,
  readOnly,
  onEdit,
  onRemove,
}: {
  boundary: GisBoundary | null;
  disabled: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  if (boundary) {
    return (
      <GisReferenceSummary
        boundary={boundary}
        actions={
          !readOnly ? (
            <div className="flex items-center gap-8">
              <Button
                size="small"
                variant="weak"
                disabled={disabled}
                onClick={onEdit}
              >
                Replace
              </Button>
              <Button
                size="small"
                variant="destructive"
                disabled={disabled}
                onClick={onRemove}
              >
                <TrashIcon size={14} weight="bold" />
                Remove
              </Button>
            </div>
          ) : undefined
        }
      />
    );
  }

  if (readOnly) {
    return (
      <EmptyState
        icon={<MapTrifoldIcon size={32} weight="bold" />}
        title="No GIS reference"
        description="Choose Edit to add the field boundary."
        padding="sm"
      />
    );
  }

  return (
    <Button
      width="full"
      disabled={disabled}
      onClick={onEdit}
      className="h-auto justify-start gap-12 whitespace-normal bg-[var(--paper)] px-16 py-16 text-left"
    >
      <span className="flex size-40 shrink-0 items-center justify-center border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]">
        <MapTrifoldIcon size={20} weight="bold" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="body-medium font-medium text-[var(--color-text-primary)]">
          Add GIS reference
        </span>
        <span className="body-small text-[var(--color-text-tertiary)]">
          Upload a .geojson file or paste the text. The boundary appears on a
          map here.
        </span>
      </span>
      <PlusIcon
        size={16}
        weight="bold"
        aria-hidden
        className="shrink-0 text-[var(--color-text-tertiary)]"
      />
    </Button>
  );
}

export function ApplicationEvidencePanel({
  applicationId,
  mode,
  boundary,
  disabled = false,
  deferredAttachments,
  readOnly = false,
  onModeChange,
  onBoundaryChange,
}: ApplicationEvidencePanelProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    ENTITY_TYPE,
    applicationId,
    { enabled: !!applicationId },
  );
  const invalidateKey = applicationId
    ? documentKeys.forEntity(ENTITY_TYPE, applicationId)
    : undefined;
  const deleteMutation = useDeleteDocument(invalidateKey, {
    entityType: ENTITY_TYPE,
  });
  const retainedDocs = (docs ?? [])
    .filter(isUploadedDocument)
    .filter(isRetainedEvidenceDocument);

  const invalidateApplicationLists = () => {
    queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
  };

  const clearHeldBoundaryFile = () => {
    for (const attachment of deferredAttachments?.attachments ?? []) {
      if (
        attachment.documentType === GIS_BOUNDARY_DOC_TYPE &&
        attachment.status !== "uploaded"
      ) {
        deferredAttachments?.remove(attachment.key);
      }
    }
  };

  const saveBoundary = (
    nextBoundary: GisBoundary,
    originalFile: File | null,
  ) => {
    clearHeldBoundaryFile();
    if (originalFile) {
      deferredAttachments?.add([originalFile], GIS_BOUNDARY_DOC_TYPE);
    }
    onBoundaryChange?.(nextBoundary);
  };

  const removeBoundary = () => {
    clearHeldBoundaryFile();
    onBoundaryChange?.(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setErrorMessage(null);
    try {
      await deleteMutation.mutateAsync(deleteId);
      invalidateApplicationLists();
      toast.success("Evidence deleted");
      setDeleteId(null);
    } catch (deleteError) {
      setErrorMessage(
        deleteError instanceof Error
          ? deleteError.message
          : "Evidence was not deleted. Try again.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-16">
      {!readOnly && (
        <RadioCardGroup
          label="Evidence method"
          value={mode}
          options={METHOD_OPTIONS}
          disabled={disabled}
          onChange={(key) =>
            onModeChange?.(key as ApplicationEvidenceMethod)
          }
        />
      )}

      {mode === "boundary" && (
        <GisReferenceField
          boundary={boundary}
          disabled={disabled}
          readOnly={readOnly}
          onEdit={() => setDialogOpen(true)}
          onRemove={removeBoundary}
        />
      )}

      <div className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-16">
        <div className="flex items-center justify-between gap-12">
          <div className="flex items-center gap-8">
            <FileIcon size={18} weight="bold" />
            <h4 className="body-large font-medium">Application mass records</h4>
            {!readOnly && (
              <InfoHint side="top" label="What to attach">
                Attach a dated weigh-scale ticket or equivalent record when
                available. These records support verification and do not block
                submission.
              </InfoHint>
            )}
          </div>
          {applicationId && (
            <span className="body-caption text-[var(--color-text-tertiary)]">
              {retainedDocs.length}{" "}
              {retainedDocs.length === 1 ? "file" : "files"}
            </span>
          )}
        </div>

        {(error || errorMessage) && (
          <ServerError
            message={
              errorMessage ??
              (error instanceof Error
                ? error.message
                : "The evidence could not be loaded. Refresh the page and try again.")
            }
          />
        )}

        {isLoading ? (
          <p className="body-small text-[var(--color-text-secondary)]">
            Loading evidence...
          </p>
        ) : (
          <EvidenceDocumentList
            docs={retainedDocs}
            disabled={disabled}
            deleteMutationPending={deleteMutation.isPending}
            onDelete={readOnly ? undefined : setDeleteId}
          />
        )}

        {!readOnly &&
          (applicationId ? (
            <FormFileUpload
              id={`application-${applicationId}-boundary-evidence-upload`}
              accept="application/pdf,.pdf"
              multiple={false}
              maxSizeMb={50}
              disabled={disabled}
              entityType={ENTITY_TYPE}
              entityId={applicationId}
              documentType={LOGBOOK_DOC_TYPE}
              onUploaded={() => {
                setErrorMessage(null);
                invalidateApplicationLists();
              }}
              onUploadError={(uploadError) => setErrorMessage(uploadError)}
            />
          ) : (
            <FormFileUpload
              id="application-create-boundary-evidence-upload"
              accept="application/pdf,.pdf"
              multiple={false}
              maxSizeMb={50}
              disabled={disabled}
              deferred
              deferredFiles={(deferredAttachments?.attachments ?? []).filter(
                (attachment) =>
                  attachment.documentType === LOGBOOK_DOC_TYPE,
              )}
              onDeferredAdd={(files) =>
                deferredAttachments?.add(files, LOGBOOK_DOC_TYPE)
              }
              onDeferredRemove={(key) => deferredAttachments?.remove(key)}
            />
          ))}
      </div>

      {!readOnly && applicationId && deferredAttachments && (
        <FailedDeferredAttachments
          attachments={deferredAttachments.attachments}
          onRetry={async (key) => {
            const result = await deferredAttachments.retry(
              ENTITY_TYPE,
              [applicationId],
              key,
            );
            if (result.uploaded.length > 0) invalidateApplicationLists();
          }}
          onRemove={deferredAttachments.remove}
          disabled={disabled}
        />
      )}

      {!readOnly && (
        <GisReferenceDialog
          isOpen={dialogOpen}
          onClose={() => setDialogOpen(false)}
          current={boundary}
          onSave={saveBoundary}
        />
      )}

      {!readOnly && (
        <DeleteConfirmDialog
          isOpen={!!deleteId}
          title="Delete Evidence"
          message="Are you sure you want to delete this evidence file?"
          onConfirm={handleDelete}
          onCancel={() => {
            setDeleteId(null);
            setErrorMessage(null);
          }}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
