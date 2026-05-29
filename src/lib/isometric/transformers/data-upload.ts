/**
 * Pure aggregator for `biochar_pyrolysis_reactor_facility_time_series`
 * DataUploadSubmissions (Phase 5 Slice A — ADR 0006).
 *
 * Buckets `production_run_readings` rows into clock-aligned windows
 * (default 60 s — the hard server-side cap surfaced by the 2026-05-29
 * sandbox smoke) and computes the per-bucket summary statistics
 * Isometric's Parquet schema requires (min, max, mean, median, count,
 * stddev, first_ts, last_ts).
 *
 * Each reading row carries up to three measurements (temperature,
 * pressure, gas flow). The aggregator transposes by `channel` —
 * each channel is bucketed independently, joined to the operator's
 * `(reactorId, measurementProperty)` sensor mapping. A channel without
 * a matching sensor is dropped (the operator must register a Sensor in
 * Certify before that channel can be published). Buckets with `count =
 * 0` are dropped because Isometric's Parquet schema marks every column
 * REQUIRED and a sparse-bucket row would carry nonsensical NaN
 * placeholders.
 *
 * Pure over its inputs — no I/O, no time, no DB. The caller is
 * responsible for the reading-row filter (clock-window against the
 * Removal's reporting period — see ADR 0006).
 */

export interface DataUploadReading {
  /** noma `production_runs.reactor_id`, joined in by the caller. */
  reactorId: string;
  /** Native JS Date — interpreted as a wall-clock instant in UTC. */
  timestamp: Date;
  temperatureC: number | null;
  pressureBar: number | null;
  gasFlowRate: number | null;
}

export interface DataUploadSensorRef {
  reactorId: string;
  /** Encoded `MeasurementProperty` (see utils/measurement-property.ts). */
  measurementProperty: string;
  /** noma-controlled stable reference (also stored on `certifier_sensors`). */
  sensorReference: string;
}

/**
 * Subset of `production_run_readings` columns the aggregator publishes,
 * paired with the encoded `MeasurementProperty` Isometric expects on
 * the matching Sensor. Hardcoded for Slice A — temperature + pressure
 * matches the sandbox smoke and the only two channels the noma reading
 * row carries that map cleanly to a documented `quantity_kind`.
 */
export type DataUploadChannel = {
  field: "temperatureC" | "pressureBar";
  measurementProperty: string;
};

export const DEFAULT_DATA_UPLOAD_CHANNELS: readonly DataUploadChannel[] = [
  { field: "temperatureC", measurementProperty: "temperature" },
  { field: "pressureBar", measurementProperty: "pressure" },
];

export interface AggregatedDataUploadRow {
  aggregationPeriodStart: Date;
  aggregationPeriodEnd: Date;
  sensorReference: string;
  minimum: number;
  maximum: number;
  mean: number;
  median: number;
  count: number;
  standardDeviation: number;
  firstTimestamp: Date;
  lastTimestamp: Date;
}

export interface AggregateDataUploadArgs {
  readings: DataUploadReading[];
  sensorRefs: DataUploadSensorRef[];
  /** Defaults to 60 — Isometric's hard cap. */
  bucketSeconds?: number;
  /** Defaults to temperature + pressure (Slice A). */
  channels?: readonly DataUploadChannel[];
}

const MS_PER_SECOND = 1_000;
const DEFAULT_BUCKET_SECONDS = 60;

interface BucketAccumulator {
  start: number;
  end: number;
  sensorReference: string;
  values: number[];
  firstTs: number;
  lastTs: number;
}

export function aggregateForDataUpload(
  args: AggregateDataUploadArgs,
): AggregatedDataUploadRow[] {
  const bucketMs = (args.bucketSeconds ?? DEFAULT_BUCKET_SECONDS) * MS_PER_SECOND;
  if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
    throw new Error("bucketSeconds must be a positive number");
  }
  const channels = args.channels ?? DEFAULT_DATA_UPLOAD_CHANNELS;

  // Build a (reactorId × measurementProperty) → sensorReference index.
  // Duplicate keys are a caller bug (the DB unique constraint prevents
  // them in storage) — throw rather than silently picking one.
  const sensorByKey = new Map<string, string>();
  for (const sensor of args.sensorRefs) {
    const key = `${sensor.reactorId}::${sensor.measurementProperty}`;
    if (sensorByKey.has(key)) {
      throw new Error(
        `Duplicate sensor ref for ${key}; data-access guards a unique constraint on (reactor_id, measurement_property).`,
      );
    }
    sensorByKey.set(key, sensor.sensorReference);
  }

  const buckets = new Map<string, BucketAccumulator>();
  for (const reading of args.readings) {
    const ts = reading.timestamp.getTime();
    if (!Number.isFinite(ts)) continue;
    const start = Math.floor(ts / bucketMs) * bucketMs;
    const end = start + bucketMs;

    for (const channel of channels) {
      const value = reading[channel.field];
      if (value == null || !Number.isFinite(value)) continue;
      const sensorReference = sensorByKey.get(
        `${reading.reactorId}::${channel.measurementProperty}`,
      );
      if (!sensorReference) continue;
      const key = `${start}::${sensorReference}`;
      let acc = buckets.get(key);
      if (!acc) {
        acc = {
          start,
          end,
          sensorReference,
          values: [],
          firstTs: ts,
          lastTs: ts,
        };
        buckets.set(key, acc);
      }
      acc.values.push(value);
      if (ts < acc.firstTs) acc.firstTs = ts;
      if (ts > acc.lastTs) acc.lastTs = ts;
    }
  }

  const rows: AggregatedDataUploadRow[] = [];
  for (const acc of buckets.values()) {
    if (acc.values.length === 0) continue;
    const stats = summarize(acc.values);
    rows.push({
      aggregationPeriodStart: new Date(acc.start),
      aggregationPeriodEnd: new Date(acc.end),
      sensorReference: acc.sensorReference,
      minimum: stats.minimum,
      maximum: stats.maximum,
      mean: stats.mean,
      median: stats.median,
      count: acc.values.length,
      standardDeviation: stats.standardDeviation,
      firstTimestamp: new Date(acc.firstTs),
      lastTimestamp: new Date(acc.lastTs),
    });
  }

  // Deterministic order — the Parquet bytes are deterministic
  // downstream of this only if row order is stable.
  rows.sort((a, b) => {
    const t =
      a.aggregationPeriodStart.getTime() - b.aggregationPeriodStart.getTime();
    if (t !== 0) return t;
    return a.sensorReference.localeCompare(b.sensorReference);
  });
  return rows;
}

function summarize(values: number[]): {
  minimum: number;
  maximum: number;
  mean: number;
  median: number;
  standardDeviation: number;
} {
  const n = values.length;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / n;
  const sorted = [...values].sort((a, b) => a - b);
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2
    : sorted[(n - 1) / 2]!;
  // Population stddev. Isometric's docs don't differentiate; population
  // is the natural fit for a per-bucket summary where the bucket IS the
  // population.
  let sqDevSum = 0;
  for (const v of values) {
    const dev = v - mean;
    sqDevSum += dev * dev;
  }
  const standardDeviation = n > 0 ? Math.sqrt(sqDevSum / n) : 0;
  return { minimum: min, maximum: max, mean, median, standardDeviation };
}
