/**
 * Typed wrappers for the Isometric `Sensor` API surface used by the
 * Phase 5 Slice A telemetry pipeline. Pure HTTP — no DB, no auth, no
 * ActionResult. `data-access/certifier-sensors.ts` consumes these for
 * persistence + reconciliation.
 */

import { createHash } from "node:crypto";
import { isometric, paginateAll } from "./client";
import type { components } from "./generated/certify";
import {
  encodeMeasurementProperty,
  type IsometricMeasurementProperty,
} from "./utils/measurement-property";

export type IsometricSensor = components["schemas"]["Sensor"];
export type CreateSensorRequest = components["schemas"]["CreateSensorRequest"];

const REACTOR_REF_PREFIX_LEN = 12;
const PROPERTY_SLUG_MAX = 24;

/**
 * Stable, noma-controlled sensor reference. The reactor short-hash
 * is stable across resets, so reconciliation via
 * `GET /sensors?reference=…` always re-finds the same sensor after a
 * sandbox wipe even if the local row was orphaned.
 */
export function buildSensorReference(args: {
  reactorId: string;
  measurementProperty: IsometricMeasurementProperty;
}): string {
  const reactorSlug = createHash("sha256")
    .update(args.reactorId)
    .digest("hex")
    .slice(0, REACTOR_REF_PREFIX_LEN);
  const propertySlug = encodeMeasurementProperty(args.measurementProperty)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PROPERTY_SLUG_MAX);
  return `nm-snr-${reactorSlug}-${propertySlug}`;
}

export async function createSensor(
  body: CreateSensorRequest,
): Promise<IsometricSensor> {
  return isometric.post<IsometricSensor>("/sensors", body);
}

export async function getSensorById(id: string): Promise<IsometricSensor> {
  return isometric.get<IsometricSensor>(`/sensors/${encodeURIComponent(id)}`);
}

/**
 * Looks up a sensor by its noma-controlled `reference`. Returns the
 * full sensor on hit, `null` on miss. Uses pagination defensively
 * even though the typical hit is one row — the API contract does not
 * guarantee a single result.
 */
export async function findSensorByReference(
  reference: string,
): Promise<IsometricSensor | null> {
  const matches = await paginateAll<IsometricSensor>("/sensors", {
    query: { reference },
    pageSize: 10,
  });
  // Defensive: the API filters server-side, but a future tightening
  // could make this strict; assert the match.
  const match = matches.find((s) => s.reference === reference);
  return match ?? null;
}
