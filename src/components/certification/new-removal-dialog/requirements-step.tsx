/**
 * RequirementsStep — step 2 of the New-Removal wizard. The facility/registry-
 * level checks that aren't a single batch's concern: project mapping, default
 * template, and cross-batch transport uniformity (design doc §3). Built from the
 * shared `buildRemovalRequirementsChecklist` so it can never disagree with the
 * full pre-flight on the rows they share. Each unmet check carries a smart fix
 * link to wherever it's resolved (§6); when not all met, "Resolve later" leaves
 * the draft removal to resume from the overview.
 */
"use client";

import type {
  RemovalRequirementCheck,
  RemovalRequirementKey,
} from "@/lib/certification/readiness";
import { certificationSettingsHref } from "@/lib/certification/links";
import { CheckRow } from "../check-row";

// Where each unmet requirement is fixed (design doc §6). All in-app, so plain
// Next <Link> navigation, facility-scoped.
function fixLinkFor(
  key: RemovalRequirementKey,
  facilityId: string,
): { label: string; href: string } {
  switch (key) {
    case "mapping":
    case "template":
      return {
        label: "Open settings",
        href: certificationSettingsHref(facilityId),
      };
    case "transportUniformity":
      return {
        label: "Review transport",
        href: `/deliveries?facility=${facilityId}`,
      };
  }
}

export function RequirementsStep({
  checklist,
  facilityId,
}: {
  checklist: RemovalRequirementCheck[];
  facilityId: string;
}) {
  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-4">
        <h3 className="title-heading-3">Registry requirements</h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          The facility-level checks the registry needs before this removal can be
          submitted.
        </p>
      </div>

      <ul className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
        {checklist.map((check, index) => (
          <CheckRow
            key={check.key}
            status={check.status}
            label={check.label}
            detail={check.detail}
            isFirst={index === 0}
            fix={
              check.status === "unmet"
                ? fixLinkFor(check.key, facilityId)
                : null
            }
          />
        ))}
      </ul>
    </div>
  );
}
