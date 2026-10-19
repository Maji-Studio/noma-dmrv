/**
 * Confirmation for deleting a customer. A customer's orders without deliveries
 * are deleted with it, so the dialog lists them before anyone confirms. If the
 * list changed since the dialog opened, it shows the new list and asks again.
 */
"use client";

import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { SheetLinkRow, SheetLinkRows } from "@/components/ui/sheet-link-row";
import { orderDeepLinkHref } from "@/lib/order-links";
import type { CascadePreview } from "@/lib/domain-errors";

/** Order codes named in the dialog; the rest are counted. */
export const CUSTOMER_DELETE_ORDERS_SHOWN = 5;

interface CustomerDeleteDialogProps {
  customerCode: string;
  /** The orders that go with the customer; undefined while they load. */
  cascade: CascadePreview | undefined;
  isLoading: boolean;
  /** Set when the order list changed since the dialog showed it. */
  changedMessage: string | null;
  errorMessage: string | undefined;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function OrdersWithoutDeliveries({ orders }: { orders: CascadePreview["orders"] }) {
  const shown = orders.slice(0, CUSTOMER_DELETE_ORDERS_SHOWN);
  const more = orders.length - shown.length;
  return (
    <div className="flex flex-col gap-8">
      <p className="body-small font-medium text-[var(--color-text-primary)]">
        {orders.length === 1 ? "This order is deleted too" : `These ${orders.length} orders are deleted too`}
      </p>
      <p className="body-small text-[var(--color-text-tertiary)]">They have no deliveries. Select one to open it.</p>
      <div aria-label="Orders deleted with this customer" role="group">
        <SheetLinkRows>
          {shown.map((order) => (
            <SheetLinkRow key={order.id} href={orderDeepLinkHref(order.id, order.facilityId)} primary={order.code} ariaLabel={`Open order ${order.code}`} />
          ))}
        </SheetLinkRows>
      </div>
      {more > 0 && <p className="body-small text-[var(--color-text-tertiary)]">{`and ${more} more`}</p>}
    </div>
  );
}

export function CustomerDeleteDialog({
  customerCode,
  cascade,
  isLoading,
  changedMessage,
  errorMessage,
  isPending,
  onConfirm,
  onCancel,
}: CustomerDeleteDialogProps) {
  return (
    <DeleteConfirmDialog
      isOpen
      title="Delete customer"
      width="md"
      message={
        <>
          <p className="font-medium text-[var(--color-text-primary)]">{`Delete customer ${customerCode} and its locations?`}</p>
          <p>This cannot be undone.</p>
        </>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
      isPending={isPending}
      confirmDisabled={isLoading || !cascade}
      errorMessage={errorMessage}
    >
      {changedMessage && <Notice tone="warning">{changedMessage}</Notice>}
      {isLoading && <p className="body-small text-[var(--color-text-tertiary)]" role="status">Checking which orders go with this customer...</p>}
      {cascade && cascade.orders.length > 0 && <OrdersWithoutDeliveries orders={cascade.orders} />}
      {cascade && cascade.orders.length === 0 && <p className="body-small text-[var(--color-text-tertiary)]">No orders are deleted with this customer.</p>}
    </DeleteConfirmDialog>
  );
}
