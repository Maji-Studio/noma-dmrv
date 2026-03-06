/**
 * Applications List Page
 * Displays the list of all field applications with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { ApplicationList } from "@/components/applications";
import { db } from "@/db";
import { deliveries, orders } from "@/db/schema/logistics";
import { biocharProducts, formulations } from "@/db/schema/products";
import { desc, eq } from "drizzle-orm";

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string | string[] }>;
}) {
  const { facility: rawFacility } = await searchParams;
  const facilityId = typeof rawFacility === "string" && rawFacility.length > 0
    ? rawFacility
    : Array.isArray(rawFacility) && rawFacility[0]
      ? rawFacility[0]
      : undefined;

  const deliveryOptions = await db
    .select({
      id: deliveries.id,
      code: deliveries.code,
      deliveryDate: deliveries.deliveryDate,
      orderCode: orders.code,
      formulationName: formulations.name,
      massDryKg: deliveries.massDryKg,
      deliveredWetMassKg: deliveries.deliveredWetMassKg,
      orderQuantityKg: orders.quantityKg,
    })
    .from(deliveries)
    .leftJoin(orders, eq(deliveries.orderId, orders.id))
    .leftJoin(biocharProducts, eq(deliveries.biocharProductId, biocharProducts.id))
    .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
    .where(facilityId ? eq(deliveries.facilityId, facilityId) : undefined)
    .orderBy(desc(deliveries.deliveryDate));

  return <ApplicationList deliveries={deliveryOptions} />;
}
