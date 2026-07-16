/**
 * The feedstock form's trailing field-less evidence step. It renders outside
 * the feedstock `<form>` because the evidence panel nests upload controls, but
 * joins the same FormSpine rail through the section tag and forwarded metadata.
 */
"use client";

import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormSection } from "@/components/forms";
import { SPINE_SECTION_TAG, type SpineMeta } from "@/components/forms/form-spine";
import { TransportEvidencePanel } from "@/components/transport-legs";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";

interface FeedstockEvidenceSectionProps {
  feedstock?: FeedstockWithRelations;
  isEditMode: boolean;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function FeedstockEvidenceSection({
  feedstock,
  isEditMode,
  __spine,
}: FeedstockEvidenceSectionProps) {
  return (
    <FormSection
      title="Transport Evidence"
      icon={<PaperclipIcon size={14} weight="bold" />}
      __spine={__spine}
    >
      {isEditMode && feedstock ? (
        <TransportEvidencePanel
          entityType="feedstock"
          entityId={feedstock.id}
        />
      ) : (
        <p className="body-small text-[var(--color-text-secondary)]">
          Save the feedstock first, then reopen it to attach transport evidence.
        </p>
      )}
    </FormSection>
  );
}

(FeedstockEvidenceSection as unknown as Record<string, boolean>)[
  SPINE_SECTION_TAG
] = true;
