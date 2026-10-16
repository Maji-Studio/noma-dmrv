/**
 * Display vocabulary for the energy page: source fills and the activity
 * number format.
 */
import type { EnergyActivityUnit, EnergySourceKey } from "@/lib/energy/sources";

/** Chart fills per source; production warm, transport cool. */
export const ENERGY_SOURCE_FILL: Record<EnergySourceKey, string> = {
  startup: "var(--acc-prod)",
  genset: "var(--st-wait)",
  preprocessing: "var(--color-signal-orange)",
  grid: "var(--acc-infra)",
  feedstockTransport: "var(--acc-dist)",
  biocharTransport: "var(--st-run)",
};

/** Below this, an activity keeps one decimal so a share never reads 0. */
const ONE_DECIMAL_BELOW = 10;

export function formatActivity(value: number, unit: EnergyActivityUnit): string {
  const digits = Math.abs(value) < ONE_DECIMAL_BELOW ? 1 : 0;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })} ${unit}`;
}
