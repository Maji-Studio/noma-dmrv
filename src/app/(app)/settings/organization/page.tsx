/** `/settings/organization` was retired by the settings console (#1277); it moved to Members. */
import { permanentRedirect } from "next/navigation";
import { SETTINGS_MEMBERS_HREF, redirectPreservingQuery, type SettingsSearchParams } from "@/lib/settings/links";

export default async function RetiredSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  permanentRedirect(redirectPreservingQuery(SETTINGS_MEMBERS_HREF, await searchParams));
}
