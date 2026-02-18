/**
 * Applications List Page
 * Displays the list of all field applications with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { ApplicationList } from "@/components/applications";
import { db } from "@/db";
import { deliveries } from "@/db/schema/logistics";
import { desc } from "drizzle-orm";

export default async function ApplicationsPage() {
  // Fetch deliveries for the form dropdown
  const deliveryOptions = await db
    .select({
      id: deliveries.id,
      code: deliveries.code,
    })
    .from(deliveries)
    .orderBy(desc(deliveries.deliveryDate));

  return <ApplicationList deliveries={deliveryOptions} />;
}
