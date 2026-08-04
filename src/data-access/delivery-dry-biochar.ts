import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { countRows, sumNumeric } from "@/db/aggregate";
import {
  biocharProducts,
  biocharProductSourceAllocations,
  deliveries,
  orders,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import {
  allocateTrackedDryBiocharKg,
  resolveProductDryBiocharKg,
} from "@/lib/biochar-mass-accounting";
import { fromCompositionMassJsonb } from "@/lib/biochar-composition";
import { SafeError } from "@/lib/errors";
import { exceedsMassWithTolerance } from "@/lib/calculations/mass-dry";
import { requireOrgScope } from "./utils";

/** Derive one server-authoritative delivery allocation while its product is locked. */
export async function deriveDeliveryDryBiocharKg(
  ctx: OrgContext,
  tx: DbTransaction,
  input: {
    biocharProductId: string;
    deliveredWetMassKg: number | null | undefined;
    excludeDeliveryId?: string;
  },
): Promise<number | null> {
  requireOrgScope(ctx);

  const [product] = await tx
    .select({
      massKg: biocharProducts.massKg,
      waterAddedKg: biocharProducts.waterAddedKg,
      moistureContentPercent: biocharProducts.moistureContentPercent,
      composition: biocharProducts.composition,
    })
    .from(biocharProducts)
    .where(and(
      eq(biocharProducts.id, input.biocharProductId),
      eq(biocharProducts.organizationId, ctx.organizationId),
    ))
    .for("update");
  if (!product) throw new SafeError("Biochar product not found");

  const [[sourceAllocation], [deliveryAllocation]] = await Promise.all([
    tx
      .select({
        allocatedDryMassKg: sumNumeric(
          biocharProductSourceAllocations.allocatedDryMassKg,
        ),
        allocationCount: countRows(),
      })
      .from(biocharProductSourceAllocations)
      .where(and(
        eq(
          biocharProductSourceAllocations.biocharProductId,
          input.biocharProductId,
        ),
        eq(
          biocharProductSourceAllocations.organizationId,
          ctx.organizationId,
        ),
      )),
    tx
      .select({
        allocatedWetMassKg: sumNumeric(deliveries.deliveredWetMassKg),
        allocatedDryMassKg: sumNumeric(deliveries.massDryKg),
        unresolvedDryCount: countRows(and(
          sql`${deliveries.deliveredWetMassKg} > 0`,
          isNull(deliveries.massDryKg),
        )),
      })
      .from(deliveries)
      .innerJoin(
        orders,
        and(
          eq(deliveries.orderId, orders.id),
          eq(orders.organizationId, ctx.organizationId),
        ),
      )
      .where(and(
        eq(deliveries.organizationId, ctx.organizationId),
        isNull(deliveries.archivedAt),
        sql`COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId}) = ${input.biocharProductId}`,
        input.excludeDeliveryId
          ? ne(deliveries.id, input.excludeDeliveryId)
          : undefined,
      )),
  ]);

  const productDryBiocharKg = resolveProductDryBiocharKg({
    sourceAllocatedDryMassKg:
      sourceAllocation.allocationCount > 0
        ? sourceAllocation.allocatedDryMassKg
        : null,
    blendMassKg: product.massKg,
    biocharMoisturePercent: product.moistureContentPercent,
    ingredients: fromCompositionMassJsonb(product.composition),
  });

  const productWetKg = product.massKg == null
    ? null
    : product.massKg + (product.waterAddedKg ?? 0);
  const remainingWetKg = productWetKg == null
    ? null
    : Math.max(0, productWetKg - deliveryAllocation.allocatedWetMassKg);
  if (
    input.deliveredWetMassKg != null &&
    remainingWetKg != null &&
    exceedsMassWithTolerance(input.deliveredWetMassKg, remainingWetKg)
  ) {
    throw new SafeError(
      "Biochar product wet mass exceeds the unallocated product balance.",
    );
  }
  if (
    productDryBiocharKg != null &&
    exceedsMassWithTolerance(
      deliveryAllocation.allocatedDryMassKg,
      productDryBiocharKg,
    )
  ) {
    throw new SafeError(
      "Dry biochar allocations exceed the linked product. Reconcile its deliveries before continuing.",
    );
  }
  if (deliveryAllocation.unresolvedDryCount > 0) {
    throw new SafeError(
      "Another delivery has no tracked dry biochar. Re-save that delivery before allocating more product.",
    );
  }

  return allocateTrackedDryBiocharKg({
    totalWetKg: productWetKg,
    totalDryBiocharKg: productDryBiocharKg,
    requestedWetKg: input.deliveredWetMassKg,
    allocatedWetKg: deliveryAllocation.allocatedWetMassKg,
    allocatedDryBiocharKg: deliveryAllocation.allocatedDryMassKg,
    hasUnresolvedDryAllocation: deliveryAllocation.unresolvedDryCount > 0,
  });
}
