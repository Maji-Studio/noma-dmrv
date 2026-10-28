/** `/settings/defaults` was retired by the settings console (#1277); it moved to General. */
import { permanentRedirect } from "next/navigation";
import { SETTINGS_GENERAL_HREF, redirectPreservingQuery, type SettingsSearchParams } from "@/lib/settings/links";

export default async function RetiredSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  permanentRedirect(redirectPreservingQuery(SETTINGS_GENERAL_HREF, await searchParams));
}
