/**
 * Persistence + reconciliation for `certifier_sensors` (Phase 5 Slice A,
 * ADR 0006). The Isometric Sensor catalog is the source of truth for
 * `externalSensorId`; the local row is the index that lets a
 * DataUploadSubmission join `(provider, reactor, measurement_property) →
 * sensor_reference` without an HTTP fan-out per submission.
 *
 * Reconciliation: `POST /sensors` is non-idempotent, so a local-row
 * loss (sandbox reset, manual delete) followed by a re-POST would
 * create a second sensor with a new `sns_…` and the same `reference`.
 * `findSensorByReference` recovers from this by claiming the existing
 * remote sensor instead.
 *
 * Organization ownership is enforced on both reactor and sensor rows.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { certifierSensors } from "@/db/schema/certification";
import { reactors } from "@/db/schema/facilities";
import { SafeError } from "@/lib/errors";
import type { OrgContext } from "@/lib/auth/server";
import { getIsometricClientForOrg } from "@/lib/isometric/client";
import {
  buildSensorReference,
  createSensor,
  findSensorByReference,
  type IsometricSensor,
} from "@/lib/isometric/sensors";
import {
  decodeMeasurementProperty,
  encodeMeasurementProperty,
  type IsometricMeasurementProperty,
} from "@/lib/isometric/utils/measurement-property";
import { assertSameOrg, requireOrgScope } from "./utils";

export type CertifierSensorRow = typeof certifierSensors.$inferSelect;

type CertifierProvider = CertifierSensorRow["provider"];

export interface EnsureSensorInput {
  reactorId: string;
  measurementProperty: IsometricMeasurementProperty;
  units: string;
  externalFacilityId: string;
  provider?: CertifierProvider;
}

/**
 * Returns the matching local sensor row, creating + persisting one
 * (or reconciling against an orphan remote row) if none exists. The
 * happy path is one local SELECT; the create path POSTs once and
 * INSERTs once.
 */
export async function ensureSensorForReactor(
  ctx: OrgContext,
  input: EnsureSensorInput,
): Promise<CertifierSensorRow> {
  requireOrgScope(ctx);
  const provider = input.provider ?? "isometric";
  const measurementKey = encodeMeasurementProperty(input.measurementProperty);

  const existing = await db
    .select()
    .from(certifierSensors)
    .where(
      and(
        eq(certifierSensors.provider, provider),
        eq(certifierSensors.reactorId, input.reactorId),
        eq(certifierSensors.measurementProperty, measurementKey),
        eq(certifierSensors.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }

  // Reactor must exist — the FK would catch this on INSERT, but we
  // want a SafeError instead of an opaque 23503 surfaced through
  // withAction.
  await assertSameOrg(ctx, reactors, input.reactorId);

  const reference = buildSensorReference({
    reactorId: input.reactorId,
    measurementProperty: input.measurementProperty,
  });
  const client = await getIsometricClientForOrg(ctx.organizationId);

  // Reconciliation FIRST — if a prior partial run created the Sensor
  // remotely but lost the local row (sandbox reset, crash before
  // INSERT), a fresh POST would mint a second sensor with the same
  // reference. Claim the existing remote first.
  let sensor: IsometricSensor | null = await findSensorByReference(client, reference);
  if (sensor) {
    if (sensor.units !== input.units) {
      throw new SafeError(
        `Sensor ${reference} uses "${sensor.units}" in Isometric, but this connection requires "${input.units}". Update the sensor units in Isometric, then try again.`,
      );
    }
  } else {
    sensor = await createSensor(client, {
      facility_id: input.externalFacilityId,
      measurement_property: input.measurementProperty,
      reference,
      units: input.units,
    });
  }

  const [row] = await db
    .insert(certifierSensors)
    .values({
      organizationId: ctx.organizationId,
      provider,
      reactorId: input.reactorId,
      measurementProperty: measurementKey,
      externalSensorId: sensor.id,
      sensorReference: sensor.reference,
      units: sensor.units,
    })
    .onConflictDoUpdate({
      target: [
        certifierSensors.provider,
        certifierSensors.reactorId,
        certifierSensors.measurementProperty,
      ],
      // A concurrent insert won the race. Adopt the winner's external
      // ids — the unique constraint guarantees one row per
      // (provider, reactor, property), and the remote Sensor catalog is the
      // source of truth.
      set: {
        externalSensorId: sql`excluded.external_sensor_id`,
        sensorReference: sql`excluded.sensor_reference`,
        units: sql`excluded.units`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row;
}

export async function listSensorsForReactors(
  ctx: OrgContext,
  reactorIds: string[],
  provider: CertifierProvider = "isometric",
): Promise<CertifierSensorRow[]> {
  requireOrgScope(ctx);
  if (reactorIds.length === 0) return [];
  return db
    .select()
    .from(certifierSensors)
    .where(
      and(
        eq(certifierSensors.provider, provider),
        inArray(certifierSensors.reactorId, reactorIds),
        eq(certifierSensors.organizationId, ctx.organizationId),
      ),
    );
}

/**
 * Convenience: hydrate the `MeasurementProperty` back from the
 * encoded key. Saves callers re-importing the encoder for read paths.
 */
export function decodeRowMeasurementProperty(
  row: CertifierSensorRow,
): IsometricMeasurementProperty {
  return decodeMeasurementProperty(row.measurementProperty);
}
