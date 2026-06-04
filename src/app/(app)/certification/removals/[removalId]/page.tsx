/**
 * Legacy per-removal Sources detail route → redirect.
 *
 * The standalone Sources/telemetry page was absorbed into the guided Review
 * flow's Evidence step (Stage 4). This route now redirects old Sources links
 * straight there, preserving the `?facility=` scope so the sidebar nav and
 * facility selector stay consistent.
 */
import { redirect } from "next/navigation";

export default async function RemovalSourcesRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ removalId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { removalId } = await params;
  const sp = await searchParams;
  const facility = typeof sp.facility === "string" ? sp.facility : undefined;

  const base = `/certification/removals/${removalId}/review?step=evidence`;
  redirect(
    facility ? `${base}&facility=${encodeURIComponent(facility)}` : base,
  );
}
