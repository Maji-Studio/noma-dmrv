"use client";

import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { FormSection } from "@/components/forms";
import type { SampleWithRelations } from "@/data-access/samples";
import { SampleDocumentsPanel } from "./sample-documents-panel";

interface SampleEvidenceSectionProps {
  sample?: SampleWithRelations;
  isEditMode: boolean;
}

export function SampleEvidenceSection({
  sample,
  isEditMode,
}: SampleEvidenceSectionProps) {
  return (
    <FormSection
      title="Evidence & Documents"
      icon={<PaperclipIcon size={14} weight="bold" />}
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
