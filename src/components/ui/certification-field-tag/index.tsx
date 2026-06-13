"use client";

import { cn } from "@/lib/utils";

const CERTIFICATION_FIELD_TAG_LABEL = "CERT";
const CERTIFICATION_FIELD_TAG_DESCRIPTION = "Required for certification";

interface CertificationFieldTagProps {
  className?: string;
  label?: string;
  description?: string;
}

export function CertificationFieldTag({
  className,
  label = CERTIFICATION_FIELD_TAG_LABEL,
  description = CERTIFICATION_FIELD_TAG_DESCRIPTION,
}: CertificationFieldTagProps) {
  return (
    <span
      className={cn(
        "body-caption border border-[var(--color-border-primary)] px-4 py-1 text-[var(--color-text-secondary)]",
        className,
      )}
    >
      {label}
      <span className="sr-only">{description}</span>
    </span>
  );
}
