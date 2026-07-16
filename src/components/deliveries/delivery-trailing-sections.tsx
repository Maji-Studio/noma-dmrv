/**
 * The delivery form's trailing field-less evidence step. It renders outside
 * the delivery `<form>` because the evidence panel nests upload controls, but
 * joins the same FormSpine rail through the section tag and forwarded metadata.
 */
"use client";

import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormFileUpload, FormSection } from "@/components/forms";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import { SPINE_SECTION_TAG, type SpineMeta } from "@/components/forms/form-spine";
import { TransportEvidencePanel } from "@/components/transport-legs";
import type { Delivery } from "@/db/schema";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";

interface DeliveryEvidenceSectionProps {
  delivery?: Delivery;
  isEditMode: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
  isSubmitting?: boolean;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function DeliveryEvidenceSection({
  delivery,
  isEditMode,
  deferredAttachments,
  isSubmitting = false,
  __spine,
}: DeliveryEvidenceSectionProps) {
  return (
    <FormSection
      title="Transport Evidence"
      icon={<PaperclipIcon size={14} weight="bold" />}
      __spine={__spine}
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
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
          <FormField id="delivery-deferred-bill-of-lading" label="Bill of lading">
            <FormFileUpload
              id="delivery-deferred-bill-of-lading"
              accept="image/*,.pdf"
              multiple={false}
              maxSizeMb={25}
              disabled={isSubmitting}
              deferred
              deferredFiles={(deferredAttachments?.attachments ?? []).filter(
                (attachment) => attachment.documentType === "bill_of_lading",
              )}
              onDeferredAdd={(files) =>
                deferredAttachments?.add(files, "bill_of_lading")
              }
              onDeferredRemove={(key) => deferredAttachments?.remove(key)}
            />
          </FormField>
          <FormField id="delivery-deferred-weighbridge-ticket" label="Weigh-scale ticket">
            <FormFileUpload
              id="delivery-deferred-weighbridge-ticket"
              accept="image/*,.pdf"
              multiple={false}
              maxSizeMb={25}
              disabled={isSubmitting}
              deferred
              deferredFiles={(deferredAttachments?.attachments ?? []).filter(
                (attachment) => attachment.documentType === "weighbridge_ticket",
              )}
              onDeferredAdd={(files) =>
                deferredAttachments?.add(files, "weighbridge_ticket")
              }
              onDeferredRemove={(key) => deferredAttachments?.remove(key)}
            />
          </FormField>
        </div>
      )}
    </FormSection>
  );
}

(DeliveryEvidenceSection as unknown as Record<string, boolean>)[
  SPINE_SECTION_TAG
] = true;
