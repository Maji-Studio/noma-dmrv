/**
 * The delivery form's trailing field-less evidence step. It renders outside
 * the delivery `<form>` because the evidence panel nests upload controls, but
 * joins the same FormSpine rail through the section tag and forwarded metadata.
 */
"use client";

import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormSection } from "@/components/forms";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import { SPINE_SECTION_TAG, type SpineMeta } from "@/components/forms/form-spine";
import {
  ClassifiedTransportEvidenceUploader,
  TransportEvidencePanel,
} from "@/components/transport-legs";
import type { Delivery } from "@/db/schema";
import { useDocumentsForEntity } from "@/hooks/use-documents";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";
import { deriveDeliveryEvidenceCertStatus } from "./delivery-evidence-cert-status";

interface DeliveryEvidenceSectionProps {
  delivery?: Delivery;
  isEditMode: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
  isSubmitting?: boolean;
  focusTarget?: EntityFocusTarget | null;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function DeliveryEvidenceSection({
  delivery,
  isEditMode,
  deferredAttachments,
  isSubmitting = false,
  focusTarget,
  __spine,
}: DeliveryEvidenceSectionProps) {
  const persisted = isEditMode && !!delivery;
  // The chip reads the saved document rows the embedded panel also lists;
  // each upload is itself a save, so the status tracks the persisted record.
  const { data: savedDocuments } = useDocumentsForEntity(
    "delivery",
    persisted ? delivery.id : null,
  );

  return (
    <FormSection
      title="Delivery evidence"
      icon={<PaperclipIcon size={14} weight="bold" />}
      certifyRequired
      certifyStatus={deriveDeliveryEvidenceCertStatus(
        savedDocuments,
        persisted,
      )}
      __spine={__spine}
    >
      <ActionableFocusTarget
        target="transport-evidence"
        activeTarget={focusTarget}
        actionLabel="Attach a proof-of-delivery document"
      >
        {isEditMode && delivery ? (
          <div className="flex flex-col gap-12">
            {deferredAttachments && (
              <FailedDeferredAttachments
                attachments={deferredAttachments.attachments}
                onRetry={(key) =>
                  deferredAttachments.retry("delivery", [delivery.id], key)
                }
                onRemove={deferredAttachments.remove}
                disabled={isSubmitting}
              />
            )}
            <TransportEvidencePanel
              entityType="delivery"
              entityId={delivery.id}
              embedded
            />
          </div>
        ) : (
          <ClassifiedTransportEvidenceUploader
            id="delivery-deferred-transport-evidence"
            entityType="delivery"
            deferredAttachments={deferredAttachments}
            disabled={isSubmitting}
          />
        )}
      </ActionableFocusTarget>
    </FormSection>
  );
}

(DeliveryEvidenceSection as unknown as Record<string, boolean>)[
  SPINE_SECTION_TAG
] = true;
