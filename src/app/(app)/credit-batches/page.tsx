/**
 * Credit Batches List Page
 * Displays the list of all credit batches with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { CreditBatchList } from "@/components/credit-batches";
import { requireAuth } from "@/lib/auth/server";
import { getCreditBatchApplicationOptions } from "@/data-access/applications";

export default async function CreditBatchesPage() {
  const user = await requireAuth();
  // Application options for the auto-match selector, via the guarded data-access
  // layer (was a raw, unguarded db query duplicated in this page). The list
  // spans all facilities, so these are intentionally unfiltered.
  const applicationOptions = await getCreditBatchApplicationOptions(user.id);

  return <CreditBatchList applications={applicationOptions} />;
}
