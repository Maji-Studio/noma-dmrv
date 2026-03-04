/**
 * Credit Batches List Page
 * Displays the list of all credit batches with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { CreditBatchList } from "@/components/credit-batches";
import { db } from "@/db";
import { facilities } from "@/db/schema/facilities";
import { applications } from "@/db/schema/application";
import { desc } from "drizzle-orm";

export default async function CreditBatchesPage() {
  // Fetch facilities for the form dropdown
  const facilityOptions = await db
    .select({
      id: facilities.id,
      name: facilities.name,
    })
    .from(facilities)
    .orderBy(desc(facilities.createdAt));

  // Fetch applications for the multi-select
  const applicationOptions = await db
    .select({
      id: applications.id,
      code: applications.code,
    })
    .from(applications)
    .orderBy(desc(applications.applicationDate));

  return (
    <CreditBatchList
      facilities={facilityOptions}
      applications={applicationOptions}
    />
  );
}
