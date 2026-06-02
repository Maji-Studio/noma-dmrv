/**
 * Thin wrapper around `hyparquet-writer` that produces the exact
 * Parquet shape Isometric's
 * `biochar_pyrolysis_reactor_facility_time_series` ingest accepts —
 * column-major data with an explicit `SchemaElement[]` carrying
 * `INT64 + logical_type TIMESTAMP NANOS` for the four timestamp columns.
 *
 * Validated end-to-end against sandbox on 2026-05-29 via
 * `scripts/probe-parquet-smoke.mts`. The schema, column ordering, and
 * type tags here MUST match that probe exactly — any divergence will
 * be flagged at submit time as an Isometric ingest error (the
 * sandbox's `error_message` names the offending column).
 */

import { parquetWriteBuffer } from "hyparquet-writer";
import type { AggregatedDataUploadRow } from "../transformers/data-upload";

/**
 * Schema parquet-writer signature is loose (no exported `SchemaElement`
 * type); we mirror the shape the probe used. `as const` literal narrow­
 * ing on each entry keeps the tags out of TS's general `string` widening.
 */
function timestampColumn(name: string) {
  return {
    name,
    type: "INT64" as const,
    logical_type: {
      type: "TIMESTAMP" as const,
      isAdjustedToUTC: true,
      unit: "NANOS" as const,
    },
    repetition_type: "REQUIRED" as const,
  };
}

// `1_000_000n` literal requires target ES2020+ (tsconfig pins ES2017
// project-wide); the wrapping BigInt() call is equivalent at runtime.
const NS_PER_MS = BigInt(1_000_000);

function toNanos(date: Date): bigint {
  return BigInt(date.getTime()) * NS_PER_MS;
}

/**
 * Returns the Parquet bytes ready for `PUT <signed_upload_url>`.
 * Throws if the row list is empty — Isometric rejects zero-row uploads
 * and emitting a header-only Parquet would burn a FileUpload for
 * nothing.
 */
export function writeDataUploadParquet(
  rows: AggregatedDataUploadRow[],
): Uint8Array {
  if (rows.length === 0) {
    throw new Error(
      "writeDataUploadParquet: refusing to emit zero-row Parquet",
    );
  }

  const ts_start: bigint[] = [];
  const ts_end: bigint[] = [];
  const sensor_refs: string[] = [];
  const minimums: number[] = [];
  const maximums: number[] = [];
  const means: number[] = [];
  const medians: number[] = [];
  const counts: bigint[] = [];
  const stds: number[] = [];
  const first_ts: bigint[] = [];
  const last_ts: bigint[] = [];

  for (const row of rows) {
    ts_start.push(toNanos(row.aggregationPeriodStart));
    ts_end.push(toNanos(row.aggregationPeriodEnd));
    sensor_refs.push(row.sensorReference);
    minimums.push(row.minimum);
    maximums.push(row.maximum);
    means.push(row.mean);
    medians.push(row.median);
    counts.push(BigInt(row.count));
    stds.push(row.standardDeviation);
    first_ts.push(toNanos(row.firstTimestamp));
    last_ts.push(toNanos(row.lastTimestamp));
  }

  const schema = [
    { name: "root", num_children: 11 },
    timestampColumn("aggregation_period_start_timestamp"),
    timestampColumn("aggregation_period_end_timestamp"),
    {
      name: "sensor_reference",
      type: "BYTE_ARRAY" as const,
      converted_type: "UTF8" as const,
      repetition_type: "REQUIRED" as const,
    },
    { name: "minimum", type: "DOUBLE" as const, repetition_type: "REQUIRED" as const },
    { name: "maximum", type: "DOUBLE" as const, repetition_type: "REQUIRED" as const },
    { name: "mean", type: "DOUBLE" as const, repetition_type: "REQUIRED" as const },
    { name: "median", type: "DOUBLE" as const, repetition_type: "REQUIRED" as const },
    { name: "count", type: "INT64" as const, repetition_type: "REQUIRED" as const },
    {
      name: "standard_deviation",
      type: "DOUBLE" as const,
      repetition_type: "REQUIRED" as const,
    },
    timestampColumn("first_timestamp"),
    timestampColumn("last_timestamp"),
  ];

  const arrayBuffer = parquetWriteBuffer({
    columnData: [
      { name: "aggregation_period_start_timestamp", data: ts_start },
      { name: "aggregation_period_end_timestamp", data: ts_end },
      { name: "sensor_reference", data: sensor_refs },
      { name: "minimum", data: minimums },
      { name: "maximum", data: maximums },
      { name: "mean", data: means },
      { name: "median", data: medians },
      { name: "count", data: counts },
      { name: "standard_deviation", data: stds },
      { name: "first_timestamp", data: first_ts },
      { name: "last_timestamp", data: last_ts },
    ],
    // hyparquet-writer's schema type is intentionally permissive — the
    // probe passed the same `as any` cast on this argument.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: schema as any,
  });
  return new Uint8Array(arrayBuffer);
}

export const DATA_UPLOAD_PARQUET_CONTENT_TYPE =
  "application/vnd.apache.parquet" as const;
