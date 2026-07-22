/**
 * Onboarding constants — the Setup steps (CONTEXT.md: "Setup step"), their
 * copy, and the deep-link targets that open each entity's create surface.
 *
 * Setup steps are NOT stored flags. Done-ness is computed from record
 * existence in `use-setup-steps.ts`; this file only holds the static metadata
 * (order, labels, copy) and the browser-storage keys the guide/wizard persist
 * to. Order is the Phase-1 traceability chain:
 * Facility → Reactor → Registry → Supplier → Feedstock → Production run →
 * Credit batch.
 */

export type SetupStepId =
  | "facility"
  | "reactor"
  | "registry"
  | "supplier"
  | "feedstock"
  | "production"
  | "credit";

export interface SetupStepMeta {
  id: SetupStepId;
  /** Full imperative label for the guide row. */
  label: string;
  /** One-word chain label for the compact strip. */
  shortLabel: string;
  /** One calm line explaining what the step is. */
  description: string;
  /** Button copy for the actionable step. */
  ctaLabel: string;
  /**
   * Legitimately optional: its done-ness still shows in the guide, but it does
   * not block the dashboard from becoming operational. The registry link is
   * skippable — a facility can produce and record removals long before (or
   * without ever) connecting Isometric.
   */
  skippable?: boolean;
}

export const SETUP_STEPS: readonly SetupStepMeta[] = [
  {
    id: "facility",
    label: "Add your facility",
    shortLabel: "Facility",
    description: "The site where biochar is produced.",
    ctaLabel: "Add facility",
  },
  {
    id: "reactor",
    label: "Register a reactor",
    shortLabel: "Reactor",
    description: "The equipment that turns feedstock into biochar.",
    ctaLabel: "Register reactor",
  },
  {
    id: "registry",
    label: "Connect your registry",
    shortLabel: "Registry",
    description: "Link this facility to its Isometric project.",
    ctaLabel: "Connect registry",
    skippable: true,
  },
  {
    id: "supplier",
    label: "Add a supplier",
    shortLabel: "Supplier",
    description: "Where your feedstock comes from.",
    ctaLabel: "Add supplier",
  },
  {
    id: "feedstock",
    label: "Record a feedstock intake",
    shortLabel: "Feedstock",
    description: "The biomass entering your reactor.",
    ctaLabel: "Record intake",
  },
  {
    id: "production",
    label: "Complete a production run",
    shortLabel: "Production run",
    description: "Turn feedstock into finished biochar.",
    ctaLabel: "Start a run",
  },
  {
    id: "credit",
    label: "Create a credit batch",
    shortLabel: "Credit batch",
    description: "Package verified removals for the registry.",
    ctaLabel: "Create batch",
  },
] as const;

export const SETUP_STEP_COUNT = SETUP_STEPS.length;

/**
 * Where a step's CTA sends the operator. All entity hubs honour `?create=true`
 * (via `useOpenCreateIntent`); the registry step routes to the certification
 * settings surface, which owns the project link. `?facility=` carries the
 * active facility so the target page lands on the right one (mirrors the
 * sidebar links).
 */
export function buildStepHref(
  id: SetupStepId,
  facilityId: string | null,
): string {
  const facilityParam = facilityId
    ? `facility=${encodeURIComponent(facilityId)}`
    : "";

  switch (id) {
    case "facility":
      // No facility exists yet — nothing to scope.
      return "/facilities?create=true";
    case "registry":
      return facilityParam
        ? `/certification/settings?${facilityParam}`
        : "/certification/settings";
    case "reactor":
    case "supplier":
    case "feedstock":
    case "production":
    case "credit": {
      const base = `/${ROUTE_SEGMENT[id]}?create=true`;
      return facilityParam ? `${base}&${facilityParam}` : base;
    }
  }
}

const ROUTE_SEGMENT: Record<
  Exclude<SetupStepId, "facility" | "registry">,
  string
> = {
  reactor: "reactors",
  supplier: "suppliers",
  feedstock: "feedstocks",
  production: "production-runs",
  credit: "credit-batches",
};

/**
 * Prefix only — `useOnboardingGate` appends `:<sessionId>:<organizationId>` so
 * a dismiss never outlives the login session or leaks across organizations in
 * the same tab. Suppresses auto-open until the tab closes or the user logs in
 * again, whichever comes first.
 */
export const ONBOARDING_WIZARD_DISMISSED_KEY =
  "noma:onboarding-wizard-dismissed";

/**
 * Prefix only — `useOnboardingGate` appends `:<userId>:<organizationId>`.
 * Persistent (localStorage): collapse the getting-started guide to a slim
 * strip, per user per organization.
 */
export const ONBOARDING_GUIDE_COLLAPSED_KEY =
  "noma:onboarding-guide-collapsed";
