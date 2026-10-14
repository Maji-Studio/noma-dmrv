import { InfoHint } from "@/components/ui/tooltip";
import { REMOVAL_FIELD_CHECK_SCOPE } from "@/lib/certification/entity-readiness";

export function CertificationScopeHeader() {
  return (
    <span className="inline-flex items-center gap-4">
      Certification
      <InfoHint label="More about certification">{REMOVAL_FIELD_CHECK_SCOPE}</InfoHint>
    </span>
  );
}
