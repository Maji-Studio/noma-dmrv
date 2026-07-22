/**
 * The feedstock form's trailing field-less evidence step. It renders outside
 * the feedstock `<form>` because the evidence panel nests upload controls, but
 * joins the same FormSpine rail through the section tag and forwarded metadata.
 */
"use client";

import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormSection } from "@/components/forms";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import { SPINE_SECTION_TAG, type SpineMeta } from "@/components/forms/form-spine";
import {
  ClassifiedTransportEvidenceUploader,
  TransportDocumentProvenanceControl,
  TransportEvidencePanel,
} from "@/components/transport-legs";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";
import type { DistanceSourceValue } from "@/schemas/distance-source";

interface FeedstockEvidenceSectionProps {
  feedstock?: FeedstockWithRelations;
  isEditMode: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
  /**
   * Every row a failed create produced (a multi-bin split makes several), so
   * retry re-attaches held evidence to each. Falls back to the edited row.
   */
  retryEntityIds?: string[];
  isSubmitting?: boolean;
  focusTarget?: EntityFocusTarget | null;
  draftDistanceSource?: DistanceSourceValue | null;
  onSelectDocumentProvenance?: () => void;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function FeedstockEvidenceSection({
  feedstock,
  isEditMode,
  deferredAttachments,
  retryEntityIds,
  isSubmitting = false,
  focusTarget,
  draftDistanceSource,
  onSelectDocumentProvenance,
  __spine,
}: FeedstockEvidenceSectionProps) {
  return (
    <FormSection
      title="Transport Evidence"
      icon={<PaperclipIcon size={14} weight="bold" />}
      __spine={__spine}
    >
      {isEditMode && feedstock ? (
        <ActionableFocusTarget
          target="transport-evidence"
          activeTarget={focusTarget}
          actionLabel="Mark the saved distance source as Document and attach supporting evidence"
          className="flex flex-col gap-12"
        >
          {deferredAttachments && (
            <FailedDeferredAttachments
              attachments={deferredAttachments.attachments}
              onRetry={(key) =>
                deferredAttachments.retry(
                  "feedstock",
                  retryEntityIds && retryEntityIds.length > 0
                    ? retryEntityIds
                    : [feedstock.id],
                  key,
                )
              }
              onRemove={deferredAttachments.remove}
              disabled={isSubmitting}
            />
          )}
          <TransportDocumentProvenanceControl
            savedSource={feedstock.transportDistanceSource}
            draftSource={draftDistanceSource}
            onSelectDocument={() => onSelectDocumentProvenance?.()}
            disabled={isSubmitting}
          />
          <TransportEvidencePanel
            entityType="feedstock"
            entityId={feedstock.id}
            embedded
            distanceSource={feedstock.transportDistanceSource}
          />
        </ActionableFocusTarget>
      ) : (
        <ClassifiedTransportEvidenceUploader
          id="feedstock-deferred-transport-evidence"
          entityType="feedstock"
          deferredAttachments={deferredAttachments}
          disabled={isSubmitting}
        />
      )}
    </FormSection>
  );
}

(FeedstockEvidenceSection as unknown as Record<string, boolean>)[
  SPINE_SECTION_TAG
] = true;
