/**
 * /admin/emission-estimates — deprecated.
 * Emission-estimate config moved into the consolidated certification workspace
 * (Settings → Emission estimates). This route now permanently redirects there,
 * preserving the active `?facility=` scope. Kept so existing bookmarks/links
 * resolve; remove once nothing references it.
 */
import { permanentRedirect } from "next/navigation";

export default async function AdminEmissionEstimatesRedirect({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>;
}) {
  const { facility } = await searchParams;
  permanentRedirect(
    facility
      ? `/certification/settings?facility=${encodeURIComponent(facility)}`
      : "/certification/settings",
  );
}
