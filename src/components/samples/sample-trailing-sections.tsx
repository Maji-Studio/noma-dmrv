/**
 * The sample form's two trailing field-less spine steps — Evidence & Documents
 * and Transport. Both render OUTSIDE the sample `<form>` element (their panels
 * nest their own forms, which HTML forbids inside another form) while still
 * joining the FormSpine rail: each carries the SPINE_SECTION_TAG and forwards
 * the injected `__spine` meta to its inner FormSection, exactly like a bare
 * FormSection child would.
 */
"use client";

import { PaperclipIcon, TruckIcon } from "@phosphor-icons/react/dist/ssr";
import { FormFileUpload, FormSection } from "@/components/forms";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import { Button } from "@/components/ui/button";
import { SPINE_SECTION_TAG, type SpineMeta } from "@/components/forms/form-spine";
import { TransportLegsEditor } from "@/components/transport-legs";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import type { TransportLegFormData } from "@/schemas/transport-legs";
import type { SampleWithRelations } from "@/data-access/samples";
import { SampleDocumentsPanel } from "./sample-documents-panel";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";

interface SampleTrailingSectionProps {
  sample?: SampleWithRelations;
  isEditMode: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
  /**
   * Retry/remove routed through the parent so it can reconcile its post-create
   * error banner from the remaining failures. Falls back to mutating the
   * deferred store directly when omitted.
   */
  onRetryAttachments?: (key?: string) => Promise<unknown>;
  onRemoveAttachment?: (key: string) => void;
  deferredLegs?: TransportLegFormData[];
  onDeferredLegsChange?: (legs: TransportLegFormData[]) => void;
  onRetryLegs?: () => Promise<void>;
  isSubmitting?: boolean;
  focusTarget?: EntityFocusTarget | null;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function SampleEvidenceSection({
  sample,
  isEditMode,
  deferredAttachments,
  onRetryAttachments,
  onRemoveAttachment,
  isSubmitting = false,
  __spine,
}: SampleTrailingSectionProps) {
  return (
    <FormSection
      title="Evidence & documents"
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
            />
          )}
          <SampleDocumentsPanel sampleId={sample.id} />
        </div>
      ) : (
        <FormFileUpload
          id="sample-deferred-documents-upload"
          accept="image/*,.pdf,.csv,.xlsx"
          multiple
          maxSizeMb={50}
          disabled={isSubmitting}
          deferred
          deferredFiles={deferredAttachments?.attachments ?? []}
          onDeferredAdd={(files) => deferredAttachments?.add(files, "lab_report")}
          onDeferredRemove={(key) => deferredAttachments?.remove(key)}
        />
      )}
    </FormSection>
  );
}

export function SampleTransportSection({
  sample,
  isEditMode,
  deferredLegs = [],
  onDeferredLegsChange,
  onRetryLegs,
  isSubmitting = false,
  focusTarget,
  __spine,
}: SampleTrailingSectionProps) {
  return (
    <FormSection title="Transport" icon={<TruckIcon size={14} weight="bold" />} __spine={__spine}>
      {isEditMode && sample ? (
        <ActionableFocusTarget
          target={
            focusTarget === "transport-evidence"
              ? "transport-evidence"
              : "transport-route"
          }
          activeTarget={focusTarget}
          actionLabel={
            focusTarget === "transport-evidence"
              ? "Edit the leg, choose Transport document as its Distance source, and upload one classified transport-evidence file"
              : "Complete the saved transport route information"
          }
          className="flex flex-col gap-12"
        >
          {deferredLegs.length > 0 && (
            <div className="flex flex-col gap-10 border border-[var(--color-status-error)] p-12">
              <div className="flex flex-wrap items-center justify-between gap-8">
                <p className="body-small font-medium text-[var(--color-status-error)]">
                  {deferredLegs.length} transport {deferredLegs.length === 1 ? "leg" : "legs"} failed to save
                </p>
                <Button
                  type="button"
                  variant="weak"
                  size="small"
                  onClick={() => void onRetryLegs?.()}
                  disabled={isSubmitting}
                >
                  Retry transport legs
                </Button>
              </div>
              {deferredLegs.map((leg, index) => (
                <div
                  key={`${leg.originName ?? "origin"}-${leg.destinationName ?? "destination"}-${index}`}
                  className="flex items-center justify-between gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
                >
                  <span className="body-small text-[var(--color-text-primary)]">
                    {leg.originName || "Origin"} → {leg.destinationName || "Destination"} · {leg.distanceKm} km
                  </span>
                  <Button
                    type="button"
                    variant="noOutline"
                    size="small"
                    onClick={() => onDeferredLegsChange?.(deferredLegs.filter((_, itemIndex) => itemIndex !== index))}
                    disabled={isSubmitting}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
          <TransportLegsEditor
            entityType="sample"
            entityId={sample.id}
            disabled={isSubmitting}
          />
        </ActionableFocusTarget>
      ) : (
        <TransportLegsEditor
          entityType="sample"
          entityId=""
          deferred
          deferredLegs={deferredLegs}
          onDeferredChange={(legs) => onDeferredLegsChange?.(legs)}
          disabled={isSubmitting}
        />
      )}
    </FormSection>
  );
}

// Join the spine's numbered rail (mirrors form-section.tsx's own tagging).
(SampleEvidenceSection as unknown as Record<string, boolean>)[
  SPINE_SECTION_TAG
] = true;
(SampleTransportSection as unknown as Record<string, boolean>)[
  SPINE_SECTION_TAG
] = true;
