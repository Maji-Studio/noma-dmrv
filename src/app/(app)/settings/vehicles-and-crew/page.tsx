/** `/settings/vehicles-and-crew` was retired by the settings console (#1277); it moved to the Vehicles and crew list page. */
import { permanentRedirect } from "next/navigation";
import { VEHICLES_AND_CREW_HREF, redirectPreservingQuery, type SettingsSearchParams } from "@/lib/settings/links";

export default async function RetiredSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  permanentRedirect(redirectPreservingQuery(VEHICLES_AND_CREW_HREF, await searchParams));
}
