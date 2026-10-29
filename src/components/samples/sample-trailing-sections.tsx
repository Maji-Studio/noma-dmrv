/** Evidence stays outside the sample form and joins the FormSpine rail. */
"use client";

import { useState } from "react";
import { DOCUMENT_UPLOAD_MAX_MB } from "@/lib/documents/upload-policy";
import { DOCUMENT_TYPE_LABELS } from "@/schemas/documents";
import { SAMPLE_DOCUMENT_ACCEPT, SampleDocumentTypePicker, type SampleDocumentType } from "./sample-document-type-picker";
import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormFileUpload, FormSection } from "@/components/forms";
import { useDocumentsCertStatus } from "@/components/forms/use-documents-cert-status";
import { certFieldStatusDescription } from "@/components/ui/certification-field-tag";
import { isLabReportDocument } from "@/lib/certification/lab-report";
import { isCertifyEntityField } from "@/lib/certification/certify-field-registry";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import { SPINE_SECTION_TAG, type SpineMeta } from "@/components/forms/form-spine";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { useIsRecordCertificationLocked } from "@/hooks/use-record-certification-lock";
import type { SampleWithRelations } from "@/data-access/samples";
import { SampleDocumentsPanel } from "./sample-documents-panel";

interface SampleTrailingSectionProps {
  sample?: SampleWithRelations;
  isEditMode: boolean;
  /** Certification context from the form (chosen batch's sampling and durability); covers create, where there is no saved sample. */
  certifyContext?: { sampling?: string | null; durabilityOption?: string | null };
  deferredAttachments?: UseDeferredAttachmentsResult;
  /**
   * Retry/remove routed through the parent so it can reconcile its post-create
   * error banner from the remaining failures. Falls back to mutating the
   * deferred store directly when omitted.
   */
  onRetryAttachments?: (key?: string) => Promise<unknown>;
  onRemoveAttachment?: (key: string) => void;
  isSubmitting?: boolean;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function SampleEvidenceSection({
  sample,
  isEditMode,
  certifyContext,
  deferredAttachments,
  onRetryAttachments,
  onRemoveAttachment,
  isSubmitting = false,
  __spine,
}: SampleTrailingSectionProps) {
  const [documentType, setDocumentType] = useState<SampleDocumentType>("lab_report");
  const locked = useIsRecordCertificationLocked("sample", isEditMode ? sample?.id : undefined);
  const labReportStatus = useDocumentsCertStatus("sample", isEditMode ? sample?.id : undefined, isLabReportDocument);
  return (
    <FormSection
      title="Evidence & documents"
      certifyRequired={isCertifyEntityField("sample", "labReport", { sampling: certifyContext?.sampling ?? sample?.sampling, durabilityOption: certifyContext?.durabilityOption ?? sample?.durabilityOption })}
      certifyStatus={labReportStatus}
      certifyDescription={certFieldStatusDescription(labReportStatus, "A lab report")}
      icon={<PaperclipIcon size={14} weight="bold" />}
      __spine={__spine}
    >
      {isEditMode && sample ? (
        <div className="flex flex-col gap-12">
          {deferredAttachments && (
            <FailedDeferredAttachments
              attachments={deferredAttachments.attachments}
              onRetry={
                onRetryAttachments ??
                ((key) => deferredAttachments.retry("sample", [sample.id], key))
              }
              onRemove={onRemoveAttachment ?? deferredAttachments.remove}
              disabled={isSubmitting}
              retryable={!locked}
            />
          )}
          <SampleDocumentsPanel sampleId={sample.id} />
        </div>
      ) : (
        <div className="space-y-12">
          <SampleDocumentTypePicker id="sample-deferred-documents-upload" value={documentType} onChange={setDocumentType} disabled={isSubmitting} />
          <FormField id="sample-deferred-documents-upload" label={DOCUMENT_TYPE_LABELS[documentType]}>
            <FormFileUpload
              id="sample-deferred-documents-upload"
              accept={SAMPLE_DOCUMENT_ACCEPT}
              multiple
              maxSizeMb={DOCUMENT_UPLOAD_MAX_MB}
              disabled={isSubmitting}
              deferred
              deferredFiles={(deferredAttachments?.attachments ?? []).map((attachment) => ({ ...attachment, classificationLabel: DOCUMENT_TYPE_LABELS[attachment.documentType] }))}
              onDeferredAdd={(files) => deferredAttachments?.add(files, documentType)}
              onDeferredRemove={(key) => deferredAttachments?.remove(key)}
            />
          </FormField>
        </div>
      )}
    </FormSection>
  );
}

// Join the spine's numbered rail (mirrors form-section.tsx's own tagging).
(SampleEvidenceSection as unknown as Record<string, boolean>)[
  SPINE_SECTION_TAG
] = true;
