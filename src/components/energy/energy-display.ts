/**
 * Display vocabulary for the energy page: source fills and the two number
 * formats, activity in its own unit and estimated CO2e.
 */
import type { EnergyActivityUnit, EnergySourceKey } from "@/lib/energy/sources";
import { formatCo2e } from "@/lib/format-utils";

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

/** Estimated CO2e, always marked as an estimate. */
export function formatEstimate(kg: number): string {
  return `est. ${formatCo2e(kg)}`;
}
