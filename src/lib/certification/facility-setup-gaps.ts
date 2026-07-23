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

export type FacilitySetupGap =
  | { kind: "project_link" }
  | { kind: "credentials" }
  | { kind: "default_template" }
  | { kind: "template_resolution"; templateId: string }
  | { kind: "blueprint_keys"; keys: string[] };

export interface FacilitySetupGapFacts {
  hasOrgCredentials: boolean;
  /** The facility → Isometric project mapping row, or null when unlinked. */
  mapping: unknown | null;
  /** The cleanly-resolved default removal template, or null. */
  defaultTemplate: unknown | null;
  /** Set when a configured default template id no longer resolves remotely. */
  missingDefaultTemplateId: string | null;
  unresolvedBlueprintKeys: string[];
}

const BLUEPRINT_OPERATOR_LABELS: Record<string, string> = {
  biochar_sequestration_1000_year: "1,000-year biochar sequestration",
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

/**
 * Derive the ordered setup gaps from the facility certifier facts. An empty
 * array means facility setup is complete (the wizard's old boolean is exactly
 * `deriveFacilitySetupGaps(facts).length === 0`). Prerequisites short-circuit
 * the way `loadFacilityCertifierFacts` does, most-fundamental first: org
 * credentials gate reaching the registry AT ALL — the project-link connector
 * disables itself until they exist — so a credential-less org must be told to
 * configure credentials, never to link a facility it structurally can't link.
 * Only then does the missing project link, then the template facts, surface.
 */
export function deriveFacilitySetupGaps(
  facts: FacilitySetupGapFacts,
): FacilitySetupGap[] {
  if (!facts.hasOrgCredentials) return [{ kind: "credentials" }];
  if (!facts.mapping) return [{ kind: "project_link" }];
  if (facts.missingDefaultTemplateId) {
    return [
      { kind: "template_resolution", templateId: facts.missingDefaultTemplateId },
    ];
  }
  if (!facts.defaultTemplate) return [{ kind: "default_template" }];
  if (facts.unresolvedBlueprintKeys.length > 0) {
    return [{ kind: "blueprint_keys", keys: facts.unresolvedBlueprintKeys }];
  }
  return [];
}
