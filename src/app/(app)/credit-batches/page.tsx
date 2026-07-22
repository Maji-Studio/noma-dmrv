/**
 * Credit Batches List Page
 * Displays the list of all credit batches with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { CreditBatchList } from "@/components/credit-batches";
import { getOrgContext } from "@/lib/auth/server";

export default async function CreditBatchesPage() {
  const ctx = await getOrgContext();
  const canManage =
    !!ctx &&
    (ctx.isPlatformAdmin || ctx.orgRole === "owner" || ctx.orgRole === "admin");

  return <CreditBatchList canManage={canManage} />;
}
