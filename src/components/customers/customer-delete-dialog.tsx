/**
 * Confirmation for deleting a customer. A customer's orders without deliveries
 * are deleted with it, so the dialog lists them before anyone confirms. If the
 * list changed since the dialog opened, it shows the new list and asks again.
 */
"use client";

import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Notice } from "@/components/ui/notice";
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
      <p className="body-small font-medium">
        {orders.length === 1 ? "This order has no deliveries and is deleted too:" : `These ${orders.length} orders have no deliveries and are deleted too:`}
      </p>
      <ul className="flex flex-col gap-4 body-small text-[var(--color-text-secondary)]" aria-label="Orders deleted with this customer">
        {shown.map((order) => (
          <li key={order.id}>{order.code}</li>
        ))}
        {more > 0 && <li>{`and ${more} more`}</li>}
      </ul>
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
      message={`Delete customer ${customerCode} and its locations? This action cannot be undone. A customer with deliveries on its orders, or with a location registered with Isometric as a storage site, cannot be deleted.`}
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
