/**
 * Legacy guided Review route → redirect.
 *
 * The standalone 5-step Review & submit flow (Assemble → Review → Evidence →
 * Pre-flight → Submit) was consolidated into the New-Removal wizard
 * (`NewRemovalDialog`, design doc §4 / §10 step 6): batch data completeness now
 * lives on the credit-batch detail page, and resuming a draft removal happens in
 * the wizard's requirements → submit steps. This route now redirects old
 * `/review` links to the overview with `?resume=<removalId>`, which opens the
 * wizard on that removal. The `?facility=` scope is preserved so the sidebar nav
 * and facility selector stay consistent; any `?step=` is intentionally dropped.
 */
import { redirect } from "next/navigation";

export default async function RemovalReviewRedirect({
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
