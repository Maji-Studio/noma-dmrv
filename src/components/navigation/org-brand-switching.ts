export function shouldShowOrganizationSwitcher(
  accessibleOrganizations: readonly unknown[],
): boolean {
  return accessibleOrganizations.length > 1;
}
