/** `/settings/api-keys` was retired by the settings console (#1277); it moved to Developers. */
import { permanentRedirect } from "next/navigation";
import { SETTINGS_DEVELOPERS_HREF, redirectPreservingQuery, type SettingsSearchParams } from "@/lib/settings/links";

export default async function RetiredSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  permanentRedirect(redirectPreservingQuery(SETTINGS_DEVELOPERS_HREF, await searchParams));
}
