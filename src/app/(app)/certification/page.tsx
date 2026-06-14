/**
 * Certification root redirect.
 *
 * The standalone Overview page was retired: the section now has three concrete
 * jobs in the sidebar — Removals, GHG Statements, and Settings. Keep the root
 * route as a compatibility entry point for bookmarks and old links, preserving
 * the active facility scope.
 */
import { redirect } from "next/navigation";
import { certificationRemovalsHref } from "@/lib/certification/links";

export default async function CertificationHomeRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  redirect(certificationRemovalsHref(sp));
}
