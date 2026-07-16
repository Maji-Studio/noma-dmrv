/**
 * The feedstock form's trailing field-less evidence step. It renders outside
 * the feedstock `<form>` because the evidence panel nests upload controls, but
 * joins the same FormSpine rail through the section tag and forwarded metadata.
 */
"use client";

import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormFileUpload, FormSection } from "@/components/forms";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import { SPINE_SECTION_TAG, type SpineMeta } from "@/components/forms/form-spine";
import { TransportEvidencePanel } from "@/components/transport-legs";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";

interface FeedstockEvidenceSectionProps {
  feedstock?: FeedstockWithRelations;
  isEditMode: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
  isSubmitting?: boolean;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function FeedstockEvidenceSection({
  feedstock,
  isEditMode,
  deferredAttachments,
  isSubmitting = false,
  __spine,
}: FeedstockEvidenceSectionProps) {
  return (
    <FormSection
      title="Transport Evidence"
      icon={<PaperclipIcon size={14} weight="bold" />}
      __spine={__spine}
    >
      {isEditMode && feedstock ? (
        <div className="flex flex-col gap-12">
          {deferredAttachments && (
            <FailedDeferredAttachments
              attachments={deferredAttachments.attachments}
              onRetry={(key) =>
                deferredAttachments.retry("feedstock", feedstock.id, key)
              }
              onRemove={deferredAttachments.remove}
              disabled={isSubmitting}
            />
          )}
          <TransportEvidencePanel
            entityType="feedstock"
            entityId={feedstock.id}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
          <FormField id="feedstock-deferred-bill-of-lading" label="Bill of lading">
            <FormFileUpload
              id="feedstock-deferred-bill-of-lading"
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
          <FormField id="feedstock-deferred-weighbridge-ticket" label="Weigh-scale ticket">
            <FormFileUpload
              id="feedstock-deferred-weighbridge-ticket"
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

(FeedstockEvidenceSection as unknown as Record<string, boolean>)[
  SPINE_SECTION_TAG
] = true;
