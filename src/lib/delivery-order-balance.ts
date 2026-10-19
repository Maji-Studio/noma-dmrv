import { formatStockLimitKg } from "./stock-overdraw";
import { GRAMS_PER_KG, kilograms, type Rational } from "./output-stock/exact";

const ZERO = BigInt(0);
const DELIVERY_ORDER_BALANCE_PREFIX = "Only ";
const DELIVERY_ORDER_BALANCE_SUFFIX =
  " remains on this order. Reduce the delivered mass.";

/** Clamp deficits and truncate exact decimals to grams so a published remainder never overdraws. */
export function publishOrderBalanceKg(value: Rational): number {
  const grams = value.numerator > ZERO ? value.numerator * GRAMS_PER_KG / value.denominator : ZERO;
  return Number(kilograms(grams));
}

export function deliveryOrderBalanceMessage(availableKg: number): string {
  return `${DELIVERY_ORDER_BALANCE_PREFIX}${formatStockLimitKg(availableKg)}${DELIVERY_ORDER_BALANCE_SUFFIX}`;
}

export function isDeliveryOrderBalanceMessage(message: string): boolean {
  return (
    message.startsWith(DELIVERY_ORDER_BALANCE_PREFIX) &&
    message.endsWith(DELIVERY_ORDER_BALANCE_SUFFIX)
  );
}
