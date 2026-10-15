"use client";

import { SegmentedControl } from "@/components/forms/segmented-control";
import { DOCUMENT_TYPE_LABELS } from "@/schemas/documents";

const SAMPLE_DOCUMENT_TYPES = ["lab_report", "reflectance_histogram"] as const;
export type SampleDocumentType = (typeof SAMPLE_DOCUMENT_TYPES)[number];

export function SampleDocumentTypePicker({ id, value, onChange, disabled = false }: {
  id: string;
  value: SampleDocumentType;
  onChange: (value: SampleDocumentType) => void;
  disabled?: boolean;
}) {
  return (
    <SegmentedControl
      id={`${id}-document-type`}
      name={`${id}-document-type`}
      legend="Document type"
      options={SAMPLE_DOCUMENT_TYPES.map((type) => ({ value: type, label: DOCUMENT_TYPE_LABELS[type] }))}
      value={value}
      onValueChange={(type) => onChange(type as SampleDocumentType)}
      disabled={disabled}
    />
  );
}
