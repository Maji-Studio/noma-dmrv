/**
 * Order side-sheet view mode: the sections config for EntitySideSheet.
 *
 * Simple is the order as saved, in the edit form's section order, plus how
 * much of it has been delivered once deliveries exist. Detailed adds the
 * matching stock and the fulfilment status. Matching stock is today's
 * availability, not part of the order, so it waits for Detailed and its section
 * only mounts there: Simple never fetches it.
 */
import { StatusBadge } from "@/components/ui/status-badge";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import type { OrderWithRelations } from "@/data-access/orders";
import { pluralize } from "@/lib/copy-utils";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import { ORDER_FULFILLMENT_DISPLAY } from "@/lib/orders/fulfillment";
import { MatchingOutputBins } from "./matching-output-bins";

/** "1,200 of 2,000 kg wet": delivered wet mass against the requested wet mass. */
function formatDeliveredMass(order: Pick<OrderWithRelations, "deliveredWetMassKg" | "quantityKg">): string {
  const digits = { digits: MASS_KG_STORAGE_DECIMALS };
  const requested = formatMassKg(order.quantityKg, digits);
  return `${order.deliveredWetMassKg.toLocaleString(undefined, { maximumFractionDigits: MASS_KG_STORAGE_DECIMALS })} of ${requested} wet`;
}

/** "1 of 2 deliveries". */
function formatDeliveredCount(order: Pick<OrderWithRelations, "deliveredCount" | "deliveryCount">): string {
  return `${order.deliveredCount} of ${order.deliveryCount} ${pluralize(order.deliveryCount, "delivery", "deliveries")}`;
}

export function orderSheetSections(order: OrderWithRelations): DetailPanelSection[] {
  const fulfillment = ORDER_FULFILLMENT_DISPLAY[order.fulfillmentStatus];
  const hasDeliveries = order.deliveryCount > 0;
  return [
    {
      title: "Order information",
      fields: [{ label: "Order date", value: formatDate(order.orderDate) }],
    },
    {
      title: "Customer details",
      fields: [
        { label: "Customer", value: order.customerName },
        { label: "Customer location", value: order.customerLocationName },
      ],
    },
    {
      title: "Product details",
      fields: [
        { label: "Formulation", value: order.formulationName },
        {
          label: "Requested wet mass (kg)",
          value: formatMassKg(order.quantityKg, { digits: MASS_KG_STORAGE_DECIMALS }),
        },
        { label: "Packaging", value: <span className="capitalize">{order.packaging}</span> },
        { label: "Value", value: order.value },
        { label: "Currency", value: order.currency },
      ],
    },
    ...(order.formulationId
      ? [{
          title: "Matching stock",
          detailedOnly: true,
          fields: [],
          content: <MatchingOutputBins facilityId={order.facilityId} formulationId={order.formulationId} />,
        }]
      : []),
    {
      title: "Fulfillment",
      // With nothing delivered yet the status is the only content, and that is Detailed.
      detailedOnly: !hasDeliveries,
      fields: [
        {
          label: "Status",
          detailedOnly: true,
          value: <StatusBadge status={fulfillment.badgeStatus} label={fulfillment.label} />,
        },
        ...(hasDeliveries ? [
          { label: "Delivered", value: formatDeliveredMass(order) },
          { label: "Deliveries", detailedOnly: true, value: formatDeliveredCount(order) },
        ] : []),
      ],
    },
  ];
}
