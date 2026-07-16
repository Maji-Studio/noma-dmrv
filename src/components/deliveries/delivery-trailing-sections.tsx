/**
 * The delivery form's trailing field-less evidence step. It renders outside
 * the delivery `<form>` because the evidence panel nests upload controls, but
 * joins the same FormSpine rail through the section tag and forwarded metadata.
 */
"use client";

import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormSection } from "@/components/forms";
import { SPINE_SECTION_TAG, type SpineMeta } from "@/components/forms/form-spine";
import { TransportEvidencePanel } from "@/components/transport-legs";
import type { Delivery } from "@/db/schema";

interface DeliveryEvidenceSectionProps {
  delivery?: Delivery;
  isEditMode: boolean;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function DeliveryEvidenceSection({
  delivery,
  isEditMode,
  __spine,
}: DeliveryEvidenceSectionProps) {
  return (
    <FormSection
      title="Transport Evidence"
      icon={<PaperclipIcon size={14} weight="bold" />}
      __spine={__spine}
    >
      {isEditMode && delivery ? (
        <TransportEvidencePanel
          entityType="delivery"
          entityId={delivery.id}
        />
      ) : (
        <p className="body-small text-[var(--color-text-secondary)]">
          Save the delivery first, then reopen it to attach transport evidence.
        </p>
      )}
    </FormSection>
  );
}

(DeliveryEvidenceSection as unknown as Record<string, boolean>)[
  SPINE_SECTION_TAG
] = true;
