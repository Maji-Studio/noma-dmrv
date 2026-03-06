/**
 * Credit Batches List Page
 * Displays the list of all credit batches with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { CreditBatchList } from "@/components/credit-batches";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { productionRuns } from "@/db/schema/production";
import { desc } from "drizzle-orm";

export default async function CreditBatchesPage() {
  // Fetch applications and production runs with rich data for the multi-selects
  const [applicationOptions, productionRunOptions] = await Promise.all([
    db
      .select({
        id: applications.id,
        code: applications.code,
        applicationDate: applications.applicationDate,
        biocharAppliedDryTons: applications.biocharAppliedDryTons,
        fieldIdentifier: applications.fieldIdentifier,
        co2eStoredTonnes: applications.co2eStoredTonnes,
      })
      .from(applications)
      .orderBy(desc(applications.applicationDate)),
    db
      .select({
        id: productionRuns.id,
        code: productionRuns.code,
        date: productionRuns.date,
        feedstockMassDryKg: productionRuns.feedstockMassDryKg,
        biocharOutputKg: productionRuns.biocharOutputKg,
        status: productionRuns.status,
      })
      .from(productionRuns)
      .orderBy(desc(productionRuns.date)),
  ]);

  return (
    <CreditBatchList
      applications={applicationOptions}
      productionRuns={productionRunOptions}
    />
  );
}
