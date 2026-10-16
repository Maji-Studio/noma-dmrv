/**
 * Credit Batches List Page
 * Displays the list of all credit batches with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { CreditBatchList } from "@/components/credit-batches";
import { PrototypeBatchList } from "@/components/credit-batches/prototype-batch-list/prototype-batch-list";
import {
  CREATE_INTENT_PARAM,
  isCreateIntentValue,
} from "@/lib/create-intent";
import { getOrgContext } from "@/lib/auth/server";

export default async function CreditBatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const ctx = await getOrgContext();
  const canManage =
    !!ctx &&
    (ctx.isPlatformAdmin || ctx.orgRole === "owner" || ctx.orgRole === "admin");

  // PROTOTYPE (throwaway): the overview variants; ?real=1 keeps today's list.
  if (query.real !== "1") return <PrototypeBatchList />;

  return (
    <CreditBatchList
      canManage={canManage}
      initialCreate={isCreateIntentValue(query[CREATE_INTENT_PARAM])}
    />
  );
}
