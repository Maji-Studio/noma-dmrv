"use client";

import { useState } from "react";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import {
  TRANSPORT_EVIDENCE_DOCUMENT_LABELS,
  TRANSPORT_EVIDENCE_DOCUMENT_TYPES,
  type TransportEvidenceDocumentType,
} from "@/lib/certification/transport-evidence";
import {
  DISTANCE_SOURCE_LABELS,
  type DistanceSourceValue,
} from "@/schemas/distance-source";

interface ClassifiedTransportEvidenceUploaderProps {
  id: string;
  entityType: "feedstock" | "delivery" | "transport_leg";
  entityId?: string;
  deferredAttachments?: UseDeferredAttachmentsResult;
  disabled?: boolean;
  onUploadError?: (message: string) => void;
}

/** One upload surface whose explicit radio selection classifies every file. */
export function ClassifiedTransportEvidenceUploader({
  id,
  entityType,
  entityId,
  deferredAttachments,
  disabled = false,
  onUploadError,
}: ClassifiedTransportEvidenceUploaderProps) {
  const toast = useToast();
  const [documentType, setDocumentType] =
    useState<TransportEvidenceDocumentType>("bill_of_lading");
  const deferred = !entityId;

  return (
    <div className="space-y-12">
      <fieldset className="space-y-8">
        <legend className="body-small font-medium text-[var(--color-text-primary)]">
          Document type
        </legend>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          {TRANSPORT_EVIDENCE_DOCUMENT_TYPES.map((value) => {
            const selected = documentType === value;
            return (
              <label
                key={value}
                className={[
                  "flex cursor-pointer items-center gap-8 border px-12 py-10 transition-colors duration-300",
                  selected
                    ? "border-[var(--color-interaction)] bg-[var(--color-background-interaction-light)]"
                    : "border-[var(--color-border-secondary)]",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name={`${id}-document-type`}
                  value={value}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => setDocumentType(value)}
                />
                <span className="body-small text-[var(--color-text-primary)]">
                  {TRANSPORT_EVIDENCE_DOCUMENT_LABELS[value]}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <FormFileUpload
        id={id}
        accept="image/*,.pdf"
        multiple
        disabled={disabled}
        entityType={entityId ? entityType : undefined}
        entityId={entityId}
        documentType={documentType}
        deferred={deferred}
        deferredFiles={(deferredAttachments?.attachments ?? []).map(
          (attachment) => ({
            ...attachment,
            classificationLabel:
              TRANSPORT_EVIDENCE_DOCUMENT_LABELS[
                attachment.documentType as TransportEvidenceDocumentType
              ] ?? attachment.documentType,
          }),
        )}
        onDeferredAdd={(files) => deferredAttachments?.add(files, documentType)}
        onDeferredRemove={(key) => deferredAttachments?.remove(key)}
        onUploaded={() => {
          onUploadError?.("");
          toast.success(
            `${TRANSPORT_EVIDENCE_DOCUMENT_LABELS[documentType]} uploaded`,
          );
        }}
        onUploadError={onUploadError}
      />
    </div>
  );
}

interface TransportDocumentProvenanceControlProps {
  savedSource?: DistanceSourceValue | null;
  draftSource?: DistanceSourceValue | null;
  onSelectDocument: () => void;
  disabled?: boolean;
}

/** Drafts a documentary provenance change in the owning parent form. */
export function TransportDocumentProvenanceControl({
  savedSource,
  draftSource,
  onSelectDocument,
  disabled = false,
}: TransportDocumentProvenanceControlProps) {
  const draftIsDocument = draftSource === "document";
  return (
    <div className="flex flex-col gap-8 border border-[var(--color-border-secondary)] px-12 py-12 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2">
        <span className="body-small font-medium text-[var(--color-text-primary)]">
          Distance provenance
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Saved: {savedSource ? DISTANCE_SOURCE_LABELS[savedSource] : "Not set"}
          {draftSource !== savedSource
            ? ` · Draft: ${draftSource ? DISTANCE_SOURCE_LABELS[draftSource] : "Not set"}`
            : ""}
        </span>
      </div>
      <Button
        type="button"
        variant="default"
        size="small"
        aria-pressed={draftIsDocument}
        disabled={disabled || draftIsDocument}
        onClick={onSelectDocument}
      >
        {draftIsDocument ? "Document selected" : "Use Document provenance"}
      </Button>
    </div>
  );
}
