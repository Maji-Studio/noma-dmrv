/**
 * Certification root redirect.
 *
 * The standalone Overview page was retired: the section now has three concrete
 * jobs in the sidebar — Removals, GHG Statements, and Settings. Keep the root
 * route as a compatibility entry point for bookmarks and old links, preserving
 * the active facility scope.
 */
import { redirect } from "next/navigation";

export default async function CertificationHomeRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, entry);
      }
    } else if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  redirect(`/certification/removals${query ? `?${query}` : ""}`);
}
