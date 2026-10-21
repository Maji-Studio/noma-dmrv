/**
 * `/settings` has no page of its own.
 *
 * The rail in `SettingsConsole` is the index, so a landing page here would be a
 * tile grid duplicating a menu that is permanently on screen. That is what
 * `/admin` was. General is the entry every member can open (Q15).
 */
import { redirect } from "next/navigation";
import { redirectPreservingQuery, SETTINGS_GENERAL_HREF, type SettingsSearchParams } from "@/lib/settings/links";

export default async function SettingsIndexPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  redirect(redirectPreservingQuery(SETTINGS_GENERAL_HREF, await searchParams));
}
