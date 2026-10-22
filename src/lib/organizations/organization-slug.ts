export const ORGANIZATION_SLUG_MAX_LENGTH = 48;
export const ORGANIZATION_SLUG_FALLBACK = "organization";

export function organizationSlugBase(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ORGANIZATION_SLUG_MAX_LENGTH)
    .replace(/-+$/, "") || ORGANIZATION_SLUG_FALLBACK;
}

export function organizationSlugCandidate(base: string, n: number): string {
  return n === 1 ? base : `${base}-${n}`;
}

export function isSlugForBase(slug: string, base: string): boolean {
  if (slug === base) return true;
  if (!slug.startsWith(`${base}-`)) return false;
  return /^(?:[2-9]|[1-9][0-9]+)$/.test(slug.slice(base.length + 1));
}
