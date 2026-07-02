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
import { FormSection } from "@/components/forms";
import { SPINE_SECTION_TAG, type SpineMeta } from "@/components/forms/form-spine";
import { TransportLegsEditor } from "@/components/transport-legs";
import type { SampleWithRelations } from "@/data-access/samples";
import { SampleDocumentsPanel } from "./sample-documents-panel";

interface SampleTrailingSectionProps {
  sample?: SampleWithRelations;
  isEditMode: boolean;
  /** Injected by FormSpine — do not set manually. */
  __spine?: SpineMeta;
}

export function SampleEvidenceSection({
  sample,
  isEditMode,
  __spine,
}: SampleTrailingSectionProps) {
  return (
    <FormSection
      title="Evidence & Documents"
      icon={<PaperclipIcon size={14} weight="bold" />}
      __spine={__spine}
    >
      {isEditMode && sample ? (
        <SampleDocumentsPanel sampleId={sample.id} />
      ) : (
        <p className="body-small text-[var(--color-text-secondary)]">
          Save the sample first, then reopen it to attach lab reports and
          supporting evidence.
        </p>
      )}
    </FormSection>
  );
}

export function SampleTransportSection({
  sample,
  isEditMode,
  __spine,
}: SampleTrailingSectionProps) {
  return (
    <FormSection title="Transport" icon={<TruckIcon size={14} weight="bold" />} __spine={__spine}>
      {isEditMode && sample ? (
        <TransportLegsEditor entityType="sample" entityId={sample.id} />
      ) : (
        <p className="body-small text-[var(--color-text-secondary)]">
          Save the sample first, then reopen it to record the lab
          shipment&apos;s transport legs.
        </p>
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
