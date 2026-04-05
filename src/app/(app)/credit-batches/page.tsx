/**
 * Credit Batches List Page
 * Displays the list of all credit batches with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { CreditBatchList } from "@/components/credit-batches";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { deliveries } from "@/db/schema/logistics";
import { desc, eq } from "drizzle-orm";

export default async function CreditBatchesPage() {
  // Fetch applications with facility info for the auto-match selector
  const applicationOptions = await db
    .select({
      id: applications.id,
      code: applications.code,
      applicationDate: applications.applicationDate,
      biocharAppliedDryTons: applications.biocharAppliedDryTons,
      fieldIdentifier: applications.fieldIdentifier,
      co2eStoredTonnes: applications.co2eStoredTonnes,
      facilityId: deliveries.facilityId,
    })
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .orderBy(desc(applications.applicationDate));

  return (
    <CreditBatchList
      applications={applicationOptions}
    />
  );
}
