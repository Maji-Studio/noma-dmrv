/**
 * Certification → Removals → guided Review & submit flow
 * Full-width stepped flow (Assemble → Review → Evidence → Pre-flight → Submit)
 * for one Removal. The active step is deep-linkable via `?step=`. Protected by
 * the requireAuth guard in the (app) layout.
 */
import { RemovalReview } from "@/components/certification/removal-review";

export default async function RemovalReviewPage({
  params,
}: {
  params: Promise<{ removalId: string }>;
}) {
  const { removalId } = await params;
  return <RemovalReview removalId={removalId} />;
}
