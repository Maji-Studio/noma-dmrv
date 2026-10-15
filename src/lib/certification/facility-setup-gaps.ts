/**
 * Facility certification setup gaps — the structured decomposition of the New
 * Removal wizard's "facility setup complete" verdict.
 *
 * The wizard used to collapse every unmet prerequisite into one boolean and
 * render it as a single "link this facility and set a template" instruction —
 * false and misleading when the actual blocker was, say, an unresolved template
 * blueprint on an already-linked facility (QA 2026-07-21 F2). Each gap here
 * names the exact unmet prerequisite so the UI can say what is actually missing
 * and where it is fixed. Pure and client-safe: derives only from the
 * facility-certifier facts the server already loads.
 */
import type { UnbindableTemplateInput } from "@/lib/isometric/template-binding-coverage";

import {
  CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
  DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
} from "@/lib/isometric/storage-blueprints";

export type FacilitySetupGap =
  | { kind: "project_link" }
  | { kind: "credentials" }
  | { kind: "external_facility_id" }
  | { kind: "default_template" }
  | { kind: "template_resolution"; templateId: string }
  | { kind: "blueprint_keys"; keys: string[] }
  | { kind: "template_unbindable"; inputs: UnbindableTemplateInput[] };

export interface FacilitySetupGapFacts {
  hasOrgCredentials: boolean;
  /** The facility → Isometric project mapping row, or null when unlinked. */
  mapping: { externalFacilityId?: string | null } | null;
  /** The cleanly-resolved default removal template, or null. */
  defaultTemplate: unknown | null;
  /** Set when a configured default template id no longer resolves remotely. */
  missingDefaultTemplateId: string | null;
  unresolvedBlueprintKeys: string[];
  unbindableTemplateInputs: UnbindableTemplateInput[];
}

const BLUEPRINT_OPERATOR_LABELS: Record<string, string> = {
  [DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR]:
    "Legacy 1,000-year biochar sequestration (total-carbon basis, uncapped)",
  [CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR]:
    "1,000-year biochar sequestration",
  biochar_sequestration_200_year: "200-year biochar sequestration",
};

/** Translate registry identifiers into copy an operator can act on. */
export function facilityBlueprintLabel(key: string): string {
  return (
    BLUEPRINT_OPERATOR_LABELS[key] ??
    key
      .split("_")
      .filter(Boolean)
      .join(" ")
      .replace(/\b1000 year\b/i, "1,000-year")
      .replace(/\b200 year\b/i, "200-year")
  );
}

/** Connection prerequisites for grouping; template health belongs to each batch pin. */
export function deriveFacilityConnectionGaps(
  facts: Pick<FacilitySetupGapFacts, "hasOrgCredentials" | "mapping">,
): FacilitySetupGap[] {
  if (!facts.hasOrgCredentials) return [{ kind: "credentials" }];
  if (!facts.mapping) return [{ kind: "project_link" }];
  if (!facts.mapping.externalFacilityId?.trim()) return [{ kind: "external_facility_id" }];
  return [];
}

/** Settings advice includes the default used when creating future batches. */
export function deriveFacilitySetupGaps(facts: FacilitySetupGapFacts): FacilitySetupGap[] {
  const connectionGaps = deriveFacilityConnectionGaps(facts);
  if (connectionGaps.length) return connectionGaps;
  if (facts.missingDefaultTemplateId) {
    return [
      { kind: "template_resolution", templateId: facts.missingDefaultTemplateId },
    ];
  }
  if (!facts.defaultTemplate) return [{ kind: "default_template" }];
  if (facts.unresolvedBlueprintKeys.length > 0) {
    return [{ kind: "blueprint_keys", keys: facts.unresolvedBlueprintKeys }];
  }
  if (facts.unbindableTemplateInputs.length > 0) {
    return [{ kind: "template_unbindable", inputs: facts.unbindableTemplateInputs }];
  }
  return [];
}
