/** Resolve a location country without ever replacing a saved edit value. */
export function resolveLocationCountry(
  location: { country: string } | undefined,
  organizationDefaultCountry: string | null,
): string {
  return location
    ? location.country
    : (organizationDefaultCountry ?? "");
}
