/**
 * Legacy per-removal Sources detail route → redirect.
 *
 * The standalone Sources/telemetry page was absorbed first into the guided
 * Review flow's Evidence step, then dissolved entirely when that flow was
 * consolidated into the New-Removal wizard (design doc §9): evidence now lives
 * on the credit-batch detail page. Old Sources links redirect to the overview
 * with `?resume=<removalId>` (which opens the wizard on that removal),
 * preserving the `?facility=` scope so the sidebar nav and facility selector
 * stay consistent.
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

  const base = `/certification/removals?resume=${encodeURIComponent(removalId)}`;
  redirect(
    facility ? `${base}&facility=${encodeURIComponent(facility)}` : base,
  );
}
