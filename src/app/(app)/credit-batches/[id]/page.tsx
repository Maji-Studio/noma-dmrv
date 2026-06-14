/**
 * Credit Batch Detail Page
 * Batch health check + detail/edit form for a single credit batch.
 * Protected by requireAuth guard in the (app) layout.
 */
import { CreditBatchDetail } from "@/components/credit-batches";
import { requireAuth } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getCreditBatchApplicationOptions } from "@/data-access/applications";
import { notFound, redirect } from "next/navigation";

interface CreditBatchDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function canonicalBatchUrl(
  id: string,
  searchParams: Record<string, string | string[] | undefined>,
  facilityId: string
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }

  params.set("facility", facilityId);
  return `/credit-batches/${encodeURIComponent(id)}?${params.toString()}`;
}

export default async function CreditBatchDetailPage({
  params,
  searchParams,
}: CreditBatchDetailPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireAuth();

  // Scope the auto-match application options to this batch's facility — the
  // inline edit form only ever matches within one facility, so loading every
  // application in the system (the previous raw, unfiltered page query) was
  // both a layer bypass and a scaling hazard. Now routed through the guarded
  // data-access layer.
  const batch = await getCreditBatchById(user.id, id, { skipPreview: true });

  if (!batch) {
    notFound();
  }

  if (firstQueryValue(sp.facility) !== batch.facilityId) {
    redirect(canonicalBatchUrl(id, sp, batch.facilityId));
  }

  const applicationOptions = await getCreditBatchApplicationOptions(
    user.id,
    batch.facilityId
  );

  return (
    <CreditBatchDetail creditBatchId={id} applications={applicationOptions} />
  );
}
