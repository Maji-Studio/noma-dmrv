/**
 * Credit Batch Detail Page
 * Batch health check + detail/edit form for a single credit batch.
 * Protected by requireAuth guard in the (app) layout.
 */
import { CreditBatchDetail } from "@/components/credit-batches";
import { requireAuth } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getCreditBatchApplicationOptions } from "@/data-access/applications";

interface CreditBatchDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CreditBatchDetailPage({
  params,
}: CreditBatchDetailPageProps) {
  const { id } = await params;
  const user = await requireAuth();

  // Scope the auto-match application options to this batch's facility — the
  // inline edit form only ever matches within one facility, so loading every
  // application in the system (the previous raw, unfiltered page query) was
  // both a layer bypass and a scaling hazard. Now routed through the guarded
  // data-access layer.
  const batch = await getCreditBatchById(user.id, id, { skipPreview: true });
  // Guard a null batch (not found / not authorized): calling the options query
  // with an undefined facilityId would drop the facility filter and load *every*
  // application in the system — the unscoped query this page was built to avoid.
  const applicationOptions = batch
    ? await getCreditBatchApplicationOptions(user.id, batch.facilityId)
    : [];

  return (
    <CreditBatchDetail creditBatchId={id} applications={applicationOptions} />
  );
}
