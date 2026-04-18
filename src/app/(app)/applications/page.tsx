/**
 * Applications List Page
 * Displays the list of all field applications with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { ApplicationList } from "@/components/applications";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { deliveries, orders } from "@/db/schema/logistics";
import { biocharProducts, formulations } from "@/db/schema/products";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { desc, eq, sql } from "drizzle-orm";

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

  const [rawDeliveries, appliedRows] = await Promise.all([
    db
      .select({
        id: deliveries.id,
        code: deliveries.code,
        deliveryDate: deliveries.deliveryDate,
        orderCode: orders.code,
        formulationName: formulations.name,
        massDryKg: deliveries.massDryKg,
        deliveredWetMassKg: deliveries.deliveredWetMassKg,
        orderQuantityKg: orders.quantityKg,
        moistureContentPercent: deliveries.moistureContentPercent,
      })
      .from(deliveries)
      .leftJoin(orders, eq(deliveries.orderId, orders.id))
      .leftJoin(biocharProducts, eq(deliveries.biocharProductId, biocharProducts.id))
      .leftJoin(formulations, eq(biocharProducts.formulationId, formulations.id))
      .where(facilityId ? eq(deliveries.facilityId, facilityId) : undefined)
      .orderBy(desc(deliveries.deliveryDate)),
    db
      .select({
        deliveryId: applications.deliveryId,
        totalAppliedKg: sql<number>`coalesce(sum(${applications.biocharAppliedTons}) * ${KG_PER_TONNE}, 0)`,
      })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(facilityId ? eq(deliveries.facilityId, facilityId) : undefined)
      .groupBy(applications.deliveryId),
  ]);

  const appliedByDeliveryId = new Map(appliedRows.map((r) => [r.deliveryId, Number(r.totalAppliedKg)]));

  const deliveryOptions = rawDeliveries.map((d) => ({
    ...d,
    alreadyAppliedWetKg: appliedByDeliveryId.get(d.id) ?? 0,
  }));

  return <ApplicationList deliveries={deliveryOptions} />;
}
