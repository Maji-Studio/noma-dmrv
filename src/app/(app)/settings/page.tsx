/**
 * `/settings` has no page of its own.
 *
 * The rail in `SettingsConsole` is the index, so a landing page here would be a
 * tile grid duplicating a menu that is permanently on screen. The former
 * platform launcher had that duplication. General is the entry every member can open (Q15).
 * Without an organization only Profile opens (#1577).
 */
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/server";
import { redirectPreservingQuery, SETTINGS_GENERAL_HREF, SETTINGS_PROFILE_HREF, type SettingsSearchParams } from "@/lib/settings/links";

export default async function SettingsIndexPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect(SETTINGS_PROFILE_HREF);
  redirect(redirectPreservingQuery(SETTINGS_GENERAL_HREF, await searchParams));
}
