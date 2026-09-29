/**
 * Order side-sheet view mode: the sections config for EntitySideSheet.
 *
 * The order as saved, in the edit form's section order, then today's matching
 * stock and the fulfilment status with what has been delivered. Both detail
 * levels show every section.
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

/** "2 deliveries". Every delivery is recorded as delivered, so the count is the whole story. */
function formatDeliveryCount(order: Pick<OrderWithRelations, "deliveryCount">): string {
  return `${order.deliveryCount} ${pluralize(order.deliveryCount, "delivery", "deliveries")}`;
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
          fields: [],
          content: <MatchingOutputBins facilityId={order.facilityId} formulationId={order.formulationId} />,
        }]
      : []),
    {
      title: "Fulfillment",
      fields: [
        {
          label: "Status",
          value: <StatusBadge status={fulfillment.badgeStatus} label={fulfillment.label} />,
        },
        ...(hasDeliveries ? [
          { label: "Delivered", value: formatDeliveredMass(order) },
          { label: "Deliveries", value: formatDeliveryCount(order) },
        ] : []),
      ],
    },
  ];
}
