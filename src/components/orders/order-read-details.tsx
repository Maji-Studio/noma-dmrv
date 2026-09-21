"use client";

import { useState } from "react";
import { FormDetailToggle, type FormDetailLevel } from "@/components/forms/form-detail-toggle";
import { DetailField, DetailRow, DetailSpine } from "@/components/ui/detail-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import type { OrderWithRelations } from "@/data-access/orders";
import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import { ORDER_FULFILLMENT_DISPLAY } from "@/lib/orders/fulfillment";
import { MatchingOutputBins } from "./matching-output-bins";

export function OrderReadDetails({ order }: { order: OrderWithRelations }) {
  const [detailLevel, setDetailLevel] = useState<FormDetailLevel>("simple");
  const fulfillment = ORDER_FULFILLMENT_DISPLAY[order.fulfillmentStatus];
  return <div className="space-y-20">
    <div className="flex justify-end"><FormDetailToggle value={detailLevel} onChange={setDetailLevel} /></div>
    <DetailSpine numbered sections={[
      { title: "Order information", fields: [{ label: "Order date", value: formatDate(order.orderDate) }] },
      { title: "Customer details", fields: [{ label: "Customer", value: order.customerName }, { label: "Customer location", value: order.customerLocationName }] },
      {
        title: "Product details",
        fields: [],
        content: <>
          <DetailRow><DetailField label="Formulation" value={order.formulationName} /></DetailRow>
          <DetailRow><DetailField label="Requested wet mass (kg)" value={formatMassKg(order.quantityKg, { digits: MASS_KG_STORAGE_DECIMALS })} /></DetailRow>
          <DetailRow><DetailField label="Packaging" value={<span className="capitalize">{order.packaging}</span>} /></DetailRow>
          <DetailRow><DetailField label="Order value" value={order.value} /><DetailField label="Currency" value={order.currency} /></DetailRow>
          {detailLevel === "detailed" && <div className="space-y-12"><div><h3 className="body-small font-medium">Current stock</h3><p className="body-caption text-[var(--color-text-secondary)]">Current availability, not a stock snapshot from the order date.</p></div><MatchingOutputBins facilityId={order.facilityId} formulationId={order.formulationId ?? ""} /></div>}
        </>,
      },
      {
        title: "Fulfillment",
        fields: [
          { label: "Fulfillment", value: <StatusBadge status={fulfillment.badgeStatus} label={fulfillment.label} /> },
          ...(order.deliveryCount > 0 ? [{ label: "Delivered", value: `${order.deliveredCount} of ${order.deliveryCount}` }] : []),
        ],
      },
    ]} />
  </div>;
}
