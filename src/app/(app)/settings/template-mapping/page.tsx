/** `/settings/template-mapping` moved next to Organizations under Platform (#1373). */
import { permanentRedirect } from "next/navigation";
import { PLATFORM_TEMPLATE_MAPPING_HREF, redirectPreservingQuery, type SettingsSearchParams } from "@/lib/settings/links";

export default async function RetiredSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  permanentRedirect(redirectPreservingQuery(PLATFORM_TEMPLATE_MAPPING_HREF, await searchParams));
}
