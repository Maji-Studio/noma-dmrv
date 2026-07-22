export const ENTITY_DEEP_LINK_MODE_PARAM = "mode";
export const ENTITY_DEEP_LINK_FOCUS_PARAM = "focus";

export const ENTITY_FOCUS_TARGETS = {
  transportRoute: "transport-route",
  transportEvidence: "transport-evidence",
} as const;

export type EntityFocusTarget =
  (typeof ENTITY_FOCUS_TARGETS)[keyof typeof ENTITY_FOCUS_TARGETS];

export function parseEntityFocusTarget(
  value: string | null | undefined,
): EntityFocusTarget | null {
  return Object.values(ENTITY_FOCUS_TARGETS).includes(
    value as EntityFocusTarget,
  )
    ? (value as EntityFocusTarget)
    : null;
}

interface BuildEntityDeepLinkInput {
  path: string;
  facilityId: string;
  entityQueryKey: string;
  entityId: string;
  focus: EntityFocusTarget;
}

/** Shared URL convention for opening a saved entity at one actionable surface. */
export function buildEntityDeepLink({
  path,
  facilityId,
  entityQueryKey,
  entityId,
  focus,
}: BuildEntityDeepLinkInput): string {
  const params = new URLSearchParams({
    facility: facilityId,
    [entityQueryKey]: entityId,
    [ENTITY_DEEP_LINK_MODE_PARAM]: "edit",
    [ENTITY_DEEP_LINK_FOCUS_PARAM]: focus,
  });
  return `${path}?${params.toString()}`;
}
