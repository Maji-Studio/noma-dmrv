import { HydrationBoundary } from "@tanstack/react-query";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { CreditBatchPage } from "@/components/credit-batches";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { creditBatchKeys } from "@/hooks/credit-batch-query-keys";
import { requireOrgContext } from "@/lib/auth/server";
import { createServerHydrationState } from "@/lib/react-query/server-hydration";

/**
 * The routed credit batch page (epic #1136). The batch loads through the
 * org-scoped read, so another organization's batch is a not-found. A
 * `?facility=` naming a different facility is a not-found too; a link without
 * one gains the batch's facility so the sidebar and facility context agree.
 */
interface CreditBatchPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CreditBatchRoute({ params, searchParams }: CreditBatchPageProps) {
  const { id } = await params;
  const sp = await searchParams;

  if (!z.uuid().safeParse(id).success) {
    notFound();
  }

  const ctx = await requireOrgContext();
  const batch = await getCreditBatchById(ctx, id);
  if (!batch) {
    notFound();
  }

  const facility = sp.facility;
  if (facility !== undefined && facility !== batch.facilityId) {
    notFound();
  }
  if (facility === undefined) {
    const nextParams = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (Array.isArray(value)) {
        for (const entry of value) nextParams.append(key, entry);
      } else if (value !== undefined) {
        nextParams.set(key, value);
      }
    }
    nextParams.set("facility", batch.facilityId);
    redirect(`/credit-batches/${id}?${nextParams.toString()}`);
  }

  const canManage = ctx.isPlatformAdmin || ctx.orgRole === "owner" || ctx.orgRole === "admin";
  const state = createServerHydrationState([
    { queryKey: creditBatchKeys.detail(batch.id), data: batch },
  ]);

  return (
    <HydrationBoundary state={state}>
      <CreditBatchPage creditBatchId={batch.id} canManage={canManage} />
    </HydrationBoundary>
  );
}
