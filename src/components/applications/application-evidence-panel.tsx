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
import { FormFileUpload, FormSelect, ServerError } from "@/components/forms";
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
  useUpdateApplicationEvidenceMetadata,
} from "@/hooks/use-documents";
import {
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_DESCRIPTIONS,
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS,
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES,
  APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE,
  APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS,
  isApplicationBoundaryLogbookEvidenceType,
  isApplicationVisualEvidenceRole,
  type ApplicationBoundaryLogbookEvidenceType,
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
const DEFAULT_LOGBOOK_EVIDENCE_TYPE: ApplicationBoundaryLogbookEvidenceType =
  "weighbridge";

const METHOD_OPTIONS = [
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

const LOGBOOK_EVIDENCE_TYPE_OPTIONS =
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES.map((type) => ({
    value: type,
    label: APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS[type],
  }));

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

function documentLogbookEvidenceType(
  doc: DocumentRow,
): ApplicationBoundaryLogbookEvidenceType | null {
  const value = metadataRecord(doc.metadata).logbookEvidenceType;
  return isApplicationBoundaryLogbookEvidenceType(value) ? value : null;
}

function documentCreatedAtMs(doc: DocumentRow): number {
  const ms = new Date(doc.createdAt).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function savedLogbookEvidenceType(
  docs: DocumentRow[],
): ApplicationBoundaryLogbookEvidenceType | null {
  let latestType: ApplicationBoundaryLogbookEvidenceType | null = null;
  let latestMs = -Infinity;
  for (const doc of docs) {
    const type = documentLogbookEvidenceType(doc);
    if (!type) continue;
    const createdAtMs = documentCreatedAtMs(doc);
    if (createdAtMs > latestMs) {
      latestType = type;
      latestMs = createdAtMs;
    }
  }
  return latestType;
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
  classifyMutationPending,
  classifyingDocumentId,
  onDelete,
  onSetLogbookEvidenceType,
}: {
  docs: DocumentRow[];
  disabled: boolean;
  deleteMutationPending: boolean;
  classifyMutationPending: boolean;
  classifyingDocumentId: string | null;
  onDelete?: (id: string) => void;
  onSetLogbookEvidenceType?: (
    id: string,
    type: ApplicationBoundaryLogbookEvidenceType,
  ) => void;
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
        const logbookEvidenceType = documentLogbookEvidenceType(doc);
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
        const isClassifying =
          classifyMutationPending && classifyingDocumentId === doc.id;
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
                {logbookEvidenceType
                  ? ` · ${APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS[logbookEvidenceType]}`
                  : ""}
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
            {onSetLogbookEvidenceType &&
              doc.documentType === LOGBOOK_DOC_TYPE && (
                <div className="w-full sm:w-192">
                  <FormSelect
                    aria-label={`Logbook evidence type for ${doc.fileName}`}
                    value={logbookEvidenceType ?? ""}
                    placeholder="Classify logbook"
                    options={LOGBOOK_EVIDENCE_TYPE_OPTIONS}
                    disabled={disabled || classifyMutationPending}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (isApplicationBoundaryLogbookEvidenceType(value)) {
                        onSetLogbookEvidenceType(doc.id, value);
                      }
                    }}
                  />
                </div>
              )}
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
                disabled={deleteMutationPending || disabled || isClassifying}
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
  const [classifyingDocumentId, setClassifyingDocumentId] = useState<
    string | null
  >(null);
  const [pickedLogbookEvidenceType, setPickedLogbookEvidenceType] =
    useState<ApplicationBoundaryLogbookEvidenceType | null>(null);
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
  const classifyMutation =
    useUpdateApplicationEvidenceMetadata(invalidateKey);
  const retainedDocs = (docs ?? [])
    .filter(isUploadedDocument)
    .filter(isRetainedEvidenceDocument);
  const logbookDocs = retainedDocs.filter(isLogbookDocument);
  const logbookEvidenceType =
    pickedLogbookEvidenceType ??
    savedLogbookEvidenceType(logbookDocs) ??
    DEFAULT_LOGBOOK_EVIDENCE_TYPE;

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

  const handleLogbookEvidenceTypeChange = (
    type: ApplicationBoundaryLogbookEvidenceType,
  ) => {
    setPickedLogbookEvidenceType(type);
    for (const attachment of deferredAttachments?.attachments ?? []) {
      if (
        attachment.documentType === LOGBOOK_DOC_TYPE &&
        attachment.status !== "uploaded"
      ) {
        deferredAttachments?.updateMeta(attachment.key, {
          applicationLogbookEvidenceType: type,
        });
      }
    }
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
          : "The evidence was not deleted. Try again.",
      );
    }
  };

  const setLogbookEvidenceTypeForDocument = async (
    documentId: string,
    type: ApplicationBoundaryLogbookEvidenceType,
  ) => {
    setErrorMessage(null);
    setClassifyingDocumentId(documentId);
    try {
      await classifyMutation.mutateAsync({
        documentId,
        applicationLogbookEvidenceType: type,
      });
      invalidateApplicationLists();
      toast.success("Evidence classified");
    } catch (classifyError) {
      setErrorMessage(
        classifyError instanceof Error
          ? classifyError.message
          : "The evidence type was not saved. Try again.",
      );
    } finally {
      setClassifyingDocumentId(null);
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

      {boundary ? (
        <GisReferenceSummary
          boundary={boundary}
          actions={
            !readOnly ? (
              <div className="flex items-center gap-8">
                <Button
                  size="small"
                  variant="weak"
                  disabled={disabled}
                  onClick={() => setDialogOpen(true)}
                >
                  Replace
                </Button>
                <Button
                  size="small"
                  variant="destructive"
                  disabled={disabled}
                  onClick={removeBoundary}
                >
                  <TrashIcon size={14} weight="bold" />
                  Remove
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : readOnly ? (
        <EmptyState
          icon={<MapTrifoldIcon size={32} weight="bold" />}
          title="No GIS reference"
          description="Choose Edit to add the field boundary."
          padding="sm"
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDialogOpen(true)}
          className="flex w-full items-center gap-12 border border-[var(--color-border-primary)] bg-[var(--paper)] px-16 py-16 text-left transition-colors duration-300 hover:bg-[var(--color-surface-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] disabled:opacity-40"
        >
          <span className="flex size-40 shrink-0 items-center justify-center border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]">
            <MapTrifoldIcon size={20} weight="bold" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="body-medium font-medium text-[var(--color-text-primary)]">
              Add GIS reference
            </span>
            <span className="body-small text-[var(--color-text-tertiary)]">
              Upload a .geojson file or paste the text. The boundary appears on
              a map here.
            </span>
          </span>
          <PlusIcon
            size={16}
            weight="bold"
            aria-hidden
            className="shrink-0 text-[var(--color-text-tertiary)]"
          />
        </button>
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

        {!readOnly && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-8">
              <h5 className="body-small-bold">Record type for the next upload</h5>
              <InfoHint side="top" label="How the record type is applied">
                This classifies the next mass record you upload. Change an
                attached file from the select beside it.
              </InfoHint>
            </div>
            <div
              className="flex flex-wrap gap-8"
              role="radiogroup"
              aria-label="Mass record type for the next upload"
            >
              {APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES.map((type) => (
                <label
                  key={type}
                  className="inline-flex min-h-44 items-center gap-8 border border-[var(--color-border-secondary)] px-12 body-small"
                >
                  <input
                    type="radio"
                    name={`application-${applicationId ?? "create"}-logbook-evidence-type`}
                    value={type}
                    checked={logbookEvidenceType === type}
                    onChange={() => handleLogbookEvidenceTypeChange(type)}
                    disabled={disabled}
                  />
                  {APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS[type]}
                </label>
              ))}
            </div>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              {
                APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_DESCRIPTIONS[
                  logbookEvidenceType
                ]
              }
            </p>
          </div>
        )}

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
            classifyMutationPending={classifyMutation.isPending}
            classifyingDocumentId={classifyingDocumentId}
            onDelete={readOnly ? undefined : setDeleteId}
            onSetLogbookEvidenceType={
              readOnly ? undefined : setLogbookEvidenceTypeForDocument
            }
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
              applicationLogbookEvidenceType={logbookEvidenceType}
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
                deferredAttachments?.add(files, LOGBOOK_DOC_TYPE, {
                  applicationLogbookEvidenceType: logbookEvidenceType,
                })
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
