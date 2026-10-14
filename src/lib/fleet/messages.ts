/**
 * Copy for vehicle, driver and operator edits and deletes.
 *
 * Pure and client-safe: the data-access layer throws these messages and the
 * settings list and edit dialogs show them as they arrive.
 */

import { formatCount } from "@/lib/copy-utils";

export type FleetKind = "vehicle" | "driver" | "operator";

/** How many records of one kind still reference a vehicle, driver or operator. */
export interface FleetUsage {
  singular: string;
  plural: string;
  count: number;
}

const FLEET_NOUN: Record<FleetKind, string> = {
  vehicle: "vehicle",
  driver: "driver",
  operator: "operator",
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "a", "a and b", "a, b and c". */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The record as the operator knows it: its code when it has one. */
function subject(kind: FleetKind, code: string | null): string {
  return code ? `${capitalize(FLEET_NOUN[kind])} ${code}` : `This ${FLEET_NOUN[kind]}`;
}

/**
 * Refusal for deleting a vehicle, driver or operator that records still use.
 * Returns null when nothing references it.
 */
export function formatFleetDeleteBlocker(
  kind: FleetKind,
  code: string | null,
  usages: readonly FleetUsage[],
): string | null {
  const used = usages.filter((usage) => usage.count > 0);
  if (used.length === 0) return null;

  const total = used.reduce((sum, usage) => sum + usage.count, 0);
  const counts = joinWithAnd(
    used.map((usage) => formatCount(usage.count, usage.singular, usage.plural)),
  );
  const verb = total === 1 ? "uses" : "use";
  return `${subject(kind, code)} was not deleted because ${counts} ${verb} it. Choose another ${FLEET_NOUN[kind]} on those records, or keep this one.`;
}
