"use client";

import { useState } from "react";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { useToast } from "@/components/ui/toast";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import {
  DELIVERY_EVIDENCE_DOCUMENT_LABELS,
  DELIVERY_EVIDENCE_DOCUMENT_TYPES,
  PROOF_OF_DELIVERY_EVIDENCE_ROLE,
  type DeliveryEvidenceDocumentType,
} from "@/lib/certification/delivery-evidence";
import {
  TRANSPORT_EVIDENCE_DOCUMENT_LABELS,
  TRANSPORT_EVIDENCE_DOCUMENT_TYPES,
  type TransportEvidenceDocumentType,
} from "@/lib/certification/transport-evidence";

type EvidenceUploaderEntityType = "feedstock" | "delivery" | "transport_leg";

type EvidenceUploaderDocumentType =
  | TransportEvidenceDocumentType
  | DeliveryEvidenceDocumentType;

// Deliveries add the two proof-of-delivery classifications (receipt,
// role-stamped photo); feedstock and transport-leg owners keep the three
// transport classifications.
const CHIP_DOCUMENT_TYPES: Record<
  EvidenceUploaderEntityType,
  readonly EvidenceUploaderDocumentType[]
> = {
  feedstock: TRANSPORT_EVIDENCE_DOCUMENT_TYPES,
  transport_leg: TRANSPORT_EVIDENCE_DOCUMENT_TYPES,
  delivery: DELIVERY_EVIDENCE_DOCUMENT_TYPES,
};

const CHIP_LABELS: Record<
  EvidenceUploaderEntityType,
  Partial<Record<EvidenceUploaderDocumentType, string>>
> = {
  feedstock: TRANSPORT_EVIDENCE_DOCUMENT_LABELS,
  transport_leg: TRANSPORT_EVIDENCE_DOCUMENT_LABELS,
  delivery: DELIVERY_EVIDENCE_DOCUMENT_LABELS,
};

export function evidenceUploaderLabel(
  entityType: EvidenceUploaderEntityType,
  documentType: string,
): string {
  return (
    CHIP_LABELS[entityType][documentType as EvidenceUploaderDocumentType] ??
    documentType
  );
}

interface ClassifiedTransportEvidenceUploaderProps {
  id: string;
  entityType: EvidenceUploaderEntityType;
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
    useState<EvidenceUploaderDocumentType>("bill_of_lading");
  const deferred = !entityId;
  const chipDocumentTypes = CHIP_DOCUMENT_TYPES[entityType];
  // The "Delivery photo" chip stamps the proof-of-delivery role so the photo
  // classifies as registry mass evidence; a bare photo never binds.
  const deliveryEvidenceRole =
    entityType === "delivery" && documentType === "photo"
      ? PROOF_OF_DELIVERY_EVIDENCE_ROLE
      : undefined;

  return (
    <div className="space-y-12">
      <fieldset className="space-y-8">
        <legend className="body-small font-medium text-[var(--color-text-primary)]">
          Document type
        </legend>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          {chipDocumentTypes.map((value) => {
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
                  {evidenceUploaderLabel(entityType, value)}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <FormFileUpload
        id={id}
        accept={documentType === "photo" ? "image/*" : "image/*,.pdf"}
        multiple
        disabled={disabled}
        entityType={entityId ? entityType : undefined}
        entityId={entityId}
        documentType={documentType}
        deliveryEvidenceRole={deliveryEvidenceRole}
        deferred={deferred}
        deferredFiles={(deferredAttachments?.attachments ?? []).map(
          (attachment) => ({
            ...attachment,
            classificationLabel: evidenceUploaderLabel(
              entityType,
              attachment.documentType,
            ),
          }),
        )}
        onDeferredAdd={(files) =>
          deferredAttachments?.add(
            files,
            documentType,
            deliveryEvidenceRole ? { deliveryEvidenceRole } : undefined,
          )
        }
        onDeferredRemove={(key) => deferredAttachments?.remove(key)}
        onUploaded={() => {
          onUploadError?.("");
          toast.success(
            `${evidenceUploaderLabel(entityType, documentType)} uploaded`,
          );
        }}
        onUploadError={onUploadError}
      />
    </div>
  );
}
