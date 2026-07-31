import { formatStockKg } from "./stock-overdraw";

const DELIVERY_ORDER_BALANCE_PREFIX = "Only ";
const DELIVERY_ORDER_BALANCE_SUFFIX =
  " remains on this order. Reduce the delivered mass.";

export function deliveryOrderBalanceMessage(availableKg: number): string {
  return `${DELIVERY_ORDER_BALANCE_PREFIX}${formatStockKg(availableKg)}${DELIVERY_ORDER_BALANCE_SUFFIX}`;
}

export function isDeliveryOrderBalanceMessage(message: string): boolean {
  return (
    message.startsWith(DELIVERY_ORDER_BALANCE_PREFIX) &&
    message.endsWith(DELIVERY_ORDER_BALANCE_SUFFIX)
  );
}
