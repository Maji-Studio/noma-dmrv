export type OrganizationSelectionInput = {
  lastActiveOrganizationId: string | null;
  accessibleOrganizationIds: readonly string[];
};

/**
 * Restore the saved organization when it remains accessible. Candidate order
 * is supplied by the caller and determines the fallback.
 */
export function selectActiveOrganizationId({
  lastActiveOrganizationId,
  accessibleOrganizationIds,
}: OrganizationSelectionInput): string | null {
  if (
    lastActiveOrganizationId &&
    accessibleOrganizationIds.includes(lastActiveOrganizationId)
  ) {
    return lastActiveOrganizationId;
  }
  return accessibleOrganizationIds[0] ?? null;
}
