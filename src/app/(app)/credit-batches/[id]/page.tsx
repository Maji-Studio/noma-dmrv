import { notFound } from "next/navigation";
import { z } from "zod";
import { PrototypeBatchPage } from "@/components/credit-batches/prototype-batch-page/prototype-batch-page";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getOrgContext, requireOrgContext } from "@/lib/auth/server";

/**
 * PROTOTYPE (throwaway): routed credit batch page with three layout variants
 * (?variant=A|B|C). The batch is loaded through the org-scoped read path.
 */
interface CreditBatchPageProps {
  params: Promise<{ id: string }>;
}

export default async function CreditBatchPage({ params }: CreditBatchPageProps) {
  const { id } = await params;

  if (!z.uuid().safeParse(id).success) {
    notFound();
  }

  const ctx = await requireOrgContext();
  const batch = await getCreditBatchById(ctx, id);
  if (!batch) {
    notFound();
  }

  const orgCtx = await getOrgContext();
  const canManage =
    !!orgCtx &&
    (orgCtx.isPlatformAdmin || orgCtx.orgRole === "owner" || orgCtx.orgRole === "admin");

  return <PrototypeBatchPage batch={batch} canManage={canManage} />;
}
