"use client";

import { useState } from "react";
import {
  ArrowSquareOutIcon,
  CameraIcon,
  FileIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { FormFileUpload, FormSelect, ServerError } from "@/components/forms";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
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
  APPLICATION_VISUAL_EVIDENCE_ROLE_DESCRIPTIONS,
  APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS,
  APPLICATION_VISUAL_EVIDENCE_ROLES,
  isApplicationBoundaryLogbookEvidenceType,
  isApplicationVisualEvidenceRole,
  type ApplicationBoundaryLogbookEvidenceType,
  type ApplicationVisualEvidenceRole,
} from "@/lib/certification/application-evidence";
import { InfoHint } from "@/components/ui/tooltip";
import { formatFileSize } from "@/lib/format-utils";
import type { DocumentRow } from "@/data-access/documents";
import type { DocumentEntityType, DocumentType } from "@/schemas/documents";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";

const ENTITY_TYPE: DocumentEntityType = "application";
const VISUAL_DOC_TYPE: DocumentType = "photo";
const BOUNDARY_DOC_TYPE: DocumentType = "pdf";

const VISUAL_ROLE_OPTIONS = APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => ({
  value: role,
  label: APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS[role],
}));
const LOGBOOK_EVIDENCE_TYPE_OPTIONS =
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES.map((type) => ({
    value: type,
    label: APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS[type],
  }));

type EvidenceMode = "visual" | "boundary";

// Mode-specific guidance shown inline (intro) and on the ⓘ tooltip (detail).
// Sourced from the Isometric "Biochar Storage in Soil Environments" module.
const EVIDENCE_INTRO: Record<EvidenceMode, string> = {
  visual:
    "Isometric requires a geotagged photo (GPS + timestamp) for each of the three application stages below — all three are needed per batch.",
  boundary:
    "Provide the GIS boundary reference above, plus at least one logbook document evidencing the quantity of biochar applied.",
};
const EVIDENCE_HINT: Record<EvidenceMode, string> = {
  visual:
    "Per the Isometric Biochar Storage in Soil module (§8.5.1), visual proof must show all three stages of every storage batch — stockpile (before), spreading (during), and incorporation (after) — each with embedded GPS coordinates and a timestamp. A single photo is not sufficient.",
  boundary:
    "Per the Isometric Biochar Storage in Soil module (§8.5.2), the boundary method needs a GIS map of the application area plus dated logbook quantities verified by weighbridge, inventory, or affidavit records.",
};

interface ApplicationEvidencePanelProps {
  applicationId?: string;
  mode: EvidenceMode;
  disabled?: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function missingExifLabel(metadata: unknown): string | null {
  const missing = metadataRecord(metadata).missingExif;
  if (!Array.isArray(missing) || missing.length === 0) return null;
  return missing.filter((item) => typeof item === "string").join(", ");
}

function isUploadedDocument(doc: DocumentRow): boolean {
  return doc.uploadStatus === "uploaded" || doc.fileUrl != null;
}

function documentEvidenceRole(
  doc: DocumentRow,
): ApplicationVisualEvidenceRole | null {
  const value = metadataRecord(doc.metadata).evidenceRole;
  return isApplicationVisualEvidenceRole(value) ? value : null;
}

function documentLogbookEvidenceType(
  doc: DocumentRow,
): ApplicationBoundaryLogbookEvidenceType | null {
  const value = metadataRecord(doc.metadata).logbookEvidenceType;
  return isApplicationBoundaryLogbookEvidenceType(value) ? value : null;
}

function isBoundaryEvidenceDocument(doc: DocumentRow): boolean {
  return (
    doc.documentType === BOUNDARY_DOC_TYPE ||
    doc.documentType === "weighbridge_ticket" ||
    doc.documentType === "affidavit"
  );
}

function EvidenceDocumentList({
  docs,
  disabled,
  deleteMutationPending,
  classifyMutationPending,
  classifyingDocumentId,
  onDelete,
  onSetVisualRole,
  onSetLogbookEvidenceType,
}: {
  docs: DocumentRow[];
  disabled: boolean;
  deleteMutationPending: boolean;
  classifyMutationPending: boolean;
  classifyingDocumentId: string | null;
  onDelete: (id: string) => void;
  onSetVisualRole?: (id: string, role: ApplicationVisualEvidenceRole) => void;
  onSetLogbookEvidenceType?: (
    id: string,
    type: ApplicationBoundaryLogbookEvidenceType,
  ) => void;
}) {
  if (docs.length === 0) {
    return (
      <p className="body-small text-[var(--color-text-secondary)]">
        No evidence files attached yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-8">
      {docs.map((doc) => {
        const missingExif = missingExifLabel(doc.metadata);
        const evidenceRole = documentEvidenceRole(doc);
        const logbookEvidenceType = documentLogbookEvidenceType(doc);
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
                {doc.capturedAt
                  ? ` · ${new Date(doc.capturedAt).toLocaleDateString()}`
                  : ""}
                {logbookEvidenceType
                  ? ` · ${APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS[logbookEvidenceType]}`
                  : ""}
              </span>
              {missingExif && (
                <span className="inline-flex items-center gap-4 body-caption text-[var(--color-signal-orange-strong)]">
                  <WarningCircleIcon size={14} weight="bold" />
                  No geotag: {missingExif}
                </span>
              )}
            </div>
            {onSetVisualRole && doc.documentType === VISUAL_DOC_TYPE && (
              <div className="w-full sm:w-200">
                <FormSelect
                  aria-label={`Evidence role for ${doc.fileName}`}
                  value={evidenceRole ?? ""}
                  placeholder="Classify evidence"
                  options={VISUAL_ROLE_OPTIONS}
                  disabled={disabled || classifyMutationPending}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isApplicationVisualEvidenceRole(value)) {
                      onSetVisualRole(doc.id, value);
                    }
                  }}
                />
              </div>
            )}
            {onSetLogbookEvidenceType && doc.documentType === BOUNDARY_DOC_TYPE && (
              <div className="w-full sm:w-200">
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
          </li>
        );
      })}
    </ul>
  );
}

export function ApplicationEvidencePanel({
  applicationId,
  mode,
  disabled = false,
  deferredAttachments,
}: ApplicationEvidencePanelProps) {
  const toast = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [classifyingDocumentId, setClassifyingDocumentId] = useState<
    string | null
  >(null);
  const [logbookEvidenceType, setLogbookEvidenceType] =
    useState<ApplicationBoundaryLogbookEvidenceType>("weighbridge");
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    ENTITY_TYPE,
    applicationId,
    { enabled: !!applicationId },
  );
  const invalidateKey = applicationId
    ? documentKeys.forEntity(ENTITY_TYPE, applicationId)
    : undefined;
  const deleteMutation = useDeleteDocument(invalidateKey);
  const classifyMutation =
    useUpdateApplicationEvidenceMetadata(invalidateKey);

  const uploadedDocs = (docs ?? []).filter(isUploadedDocument);
  const visualDocs = uploadedDocs.filter(
    (doc) => doc.documentType === VISUAL_DOC_TYPE,
  );
  const boundaryDocs = uploadedDocs.filter(isBoundaryEvidenceDocument);
  const visibleDocs = mode === "visual" ? visualDocs : boundaryDocs;

  const handleDelete = async () => {
    if (!deleteId) return;
    setErrorMessage(null);
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Evidence deleted");
      setDeleteId(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to delete evidence",
      );
    }
  };

  const setVisualRole = async (
    documentId: string,
    role: ApplicationVisualEvidenceRole,
  ) => {
    setErrorMessage(null);
    setClassifyingDocumentId(documentId);
    try {
      await classifyMutation.mutateAsync({
        documentId,
        applicationEvidenceRole: role,
      });
      toast.success("Evidence classified");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to classify evidence",
      );
    } finally {
      setClassifyingDocumentId(null);
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
      toast.success("Evidence classified");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to classify evidence",
      );
    } finally {
      setClassifyingDocumentId(null);
    }
  };

  if (!applicationId) {
    return (
      <section className="flex flex-col gap-12 border border-[var(--color-border-secondary)] p-16">
        <header className="flex items-center gap-8">
          {mode === "visual" ? (
            <CameraIcon size={18} weight="bold" />
          ) : (
            <FileIcon size={18} weight="bold" />
          )}
          <h3 className="title-heading-3">Evidence</h3>
          <InfoHint side="top" label="What evidence is required">
            {EVIDENCE_HINT[mode]}
          </InfoHint>
        </header>
        <p className="body-small text-[var(--color-text-secondary)]">
          {EVIDENCE_INTRO[mode]}
        </p>
        {mode === "visual" ? (
          <div className="flex flex-col gap-12">
            {APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => (
              <div
                key={role}
                className="flex flex-col gap-10 border border-[var(--color-border-tertiary)] p-12"
              >
                <div className="flex flex-col gap-2">
                  <h4 className="body-small-bold">
                    {APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS[role]}
                  </h4>
                  <p className="body-caption text-[var(--color-text-tertiary)]">
                    {APPLICATION_VISUAL_EVIDENCE_ROLE_DESCRIPTIONS[role]}
                  </p>
                </div>
                <FormFileUpload
                  id={`application-create-${role}-evidence-upload`}
                  accept="image/*"
                  multiple
                  maxSizeMb={25}
                  disabled={disabled}
                  deferred
                  deferredFiles={(deferredAttachments?.attachments ?? []).filter(
                    (attachment) =>
                      attachment.extraMeta?.applicationEvidenceRole === role,
                  )}
                  onDeferredAdd={(files) =>
                    deferredAttachments?.add(files, VISUAL_DOC_TYPE, {
                      applicationEvidenceRole: role,
                    })
                  }
                  onDeferredRemove={(key) => deferredAttachments?.remove(key)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-12">
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap gap-8">
                {APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES.map((type) => (
                  <label
                    key={type}
                    className="inline-flex min-h-44 items-center gap-8 border border-[var(--color-border-secondary)] px-12 body-small"
                  >
                    <input
                      type="radio"
                      name="application-create-logbook-evidence-type"
                      value={type}
                      checked={logbookEvidenceType === type}
                      onChange={() => setLogbookEvidenceType(type)}
                      disabled={disabled}
                    />
                    {APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
              <p className="body-caption text-[var(--color-text-tertiary)]">
                {APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_DESCRIPTIONS[logbookEvidenceType]}
              </p>
            </div>
            <FormFileUpload
              id="application-create-boundary-evidence-upload"
              accept="application/pdf,.pdf"
              multiple={false}
              maxSizeMb={50}
              disabled={disabled}
              deferred
              deferredFiles={(deferredAttachments?.attachments ?? []).filter(
                (attachment) => attachment.documentType === BOUNDARY_DOC_TYPE,
              )}
              onDeferredAdd={(files) =>
                deferredAttachments?.add(files, BOUNDARY_DOC_TYPE, {
                  applicationLogbookEvidenceType: logbookEvidenceType,
                })
              }
              onDeferredRemove={(key) => deferredAttachments?.remove(key)}
            />
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-12 border border-[var(--color-border-secondary)] p-16">
      {deferredAttachments && (
        <FailedDeferredAttachments
          attachments={deferredAttachments.attachments}
          onRetry={(key) =>
            deferredAttachments.retry(ENTITY_TYPE, applicationId, key)
          }
          onRemove={deferredAttachments.remove}
          disabled={disabled}
        />
      )}
      <header className="flex items-center justify-between gap-12">
        <h3 className="title-heading-3 flex items-center gap-8">
          {mode === "visual" ? (
            <CameraIcon size={18} weight="bold" />
          ) : (
            <FileIcon size={18} weight="bold" />
          )}
          Evidence
          <InfoHint side="top" label="What evidence is required">
            {EVIDENCE_HINT[mode]}
          </InfoHint>
        </h3>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {visibleDocs.length} {visibleDocs.length === 1 ? "file" : "files"}
        </span>
      </header>

      <p className="body-small text-[var(--color-text-secondary)]">
        {EVIDENCE_INTRO[mode]}
      </p>

      {(error || errorMessage) && (
        <ServerError
          message={
            errorMessage ??
            (error instanceof Error ? error.message : "Failed to load evidence")
          }
        />
      )}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          Loading evidence...
        </p>
      ) : mode === "visual" ? (
        <div className="flex flex-col gap-12">
          {APPLICATION_VISUAL_EVIDENCE_ROLES.map((role) => {
            const roleDocs = visualDocs.filter(
              (doc) => documentEvidenceRole(doc) === role,
            );
            return (
              <div
                key={role}
                className="flex flex-col gap-10 border border-[var(--color-border-tertiary)] p-12"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-8">
                    <h4 className="body-small-bold">
                      {APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS[role]}
                    </h4>
                    <span className="body-caption text-[var(--color-text-tertiary)]">
                      {roleDocs.length} {roleDocs.length === 1 ? "file" : "files"}
                    </span>
                  </div>
                  <p className="body-caption text-[var(--color-text-tertiary)]">
                    {APPLICATION_VISUAL_EVIDENCE_ROLE_DESCRIPTIONS[role]}
                  </p>
                </div>
                <EvidenceDocumentList
                  docs={roleDocs}
                  disabled={disabled}
                  deleteMutationPending={deleteMutation.isPending}
                  classifyMutationPending={classifyMutation.isPending}
                  classifyingDocumentId={classifyingDocumentId}
                  onDelete={setDeleteId}
                  onSetVisualRole={setVisualRole}
                />
                <FormFileUpload
                  id={`application-${applicationId}-${role}-evidence-upload`}
                  accept="image/*"
                  multiple
                  maxSizeMb={25}
                  disabled={disabled}
                  entityType={ENTITY_TYPE}
                  entityId={applicationId}
                  documentType={VISUAL_DOC_TYPE}
                  applicationEvidenceRole={role}
                  onUploaded={() => setErrorMessage(null)}
                  onUploadError={(err) => setErrorMessage(err)}
                />
              </div>
            );
          })}

          {visualDocs.some((doc) => documentEvidenceRole(doc) === null) && (
            <div className="flex flex-col gap-10 border border-[var(--color-border-tertiary)] p-12">
              <div className="flex items-center justify-between gap-8">
                <h4 className="body-small-bold">Unclassified</h4>
              </div>
              <EvidenceDocumentList
                docs={visualDocs.filter(
                  (doc) => documentEvidenceRole(doc) === null,
                )}
                disabled={disabled}
                deleteMutationPending={deleteMutation.isPending}
                classifyMutationPending={classifyMutation.isPending}
                classifyingDocumentId={classifyingDocumentId}
                onDelete={setDeleteId}
                onSetVisualRole={setVisualRole}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-12">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap gap-8">
              {APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES.map((type) => (
                <label
                  key={type}
                  className="inline-flex min-h-44 items-center gap-8 border border-[var(--color-border-secondary)] px-12 body-small"
                >
                  <input
                    type="radio"
                    name={`application-${applicationId}-logbook-evidence-type`}
                    value={type}
                    checked={logbookEvidenceType === type}
                    onChange={() => setLogbookEvidenceType(type)}
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
          <EvidenceDocumentList
            docs={boundaryDocs}
            disabled={disabled}
            deleteMutationPending={deleteMutation.isPending}
            classifyMutationPending={classifyMutation.isPending}
            classifyingDocumentId={classifyingDocumentId}
            onDelete={setDeleteId}
            onSetLogbookEvidenceType={setLogbookEvidenceTypeForDocument}
          />
          <FormFileUpload
            id={`application-${applicationId}-boundary-evidence-upload`}
            accept="application/pdf,.pdf"
            multiple={false}
            maxSizeMb={50}
            disabled={disabled}
            entityType={ENTITY_TYPE}
            entityId={applicationId}
            documentType={BOUNDARY_DOC_TYPE}
            applicationLogbookEvidenceType={logbookEvidenceType}
            onUploaded={() => setErrorMessage(null)}
            onUploadError={(err) => setErrorMessage(err)}
          />
        </div>
      )}

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
    </section>
  );
}
