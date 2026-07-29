import { pluralize } from "@/lib/copy-utils";

/**
 * Canonical production-readings CSV parser (issue #207).
 *
 * The stakeholder exports one CSV per reactor with a full **UTC timestamp**
 * on every row, so a single file can span multiple days. This replaces the
 * older reactor-day format (filename date + local `HH:MM` per row + a
 * column-mapping step), which existed only to cope with the plant PLC's raw
 * multi-column export. With an agreed canonical header set we can match
 * columns directly and drop all of that.
 *
 * Canonical columns (header row required, case-insensitive, extra columns
 * ignored):
 *   - `timestamp_utc`        (required) ISO-8601 UTC, e.g. 2026-04-02T22:15:00Z
 *   - `temperature_c`        (required) °C
 *   - `pressure_bar`         (required) bar
 *   - `dryer_frequency_hz`   (optional) Hz — leave blank if not measured
 *   - `reactor_frequency_hz` (optional) Hz — leave blank if not measured
 *
 * Pure over its inputs — no I/O, no ambient time, no DB. The importer clips
 * readings to the production-run window, so readings never fall outside a run.
 */

const EMPTY_SENSOR_VALUE = "---";
const UTF8_BOM = "﻿";
const MS_PER_MINUTE = 60_000;

/** Canonical header -> accepted aliases (all lower-cased, trimmed). */
const COLUMN_ALIASES = {
  timestamp: ["timestamp_utc", "timestamp", "time_utc", "time (utc)", "datetime_utc", "datetime"],
  temperature: ["temperature_c", "temperature", "temp_c", "temp"],
  pressure: ["pressure_bar", "pressure"],
  dryerFrequency: ["dryer_frequency_hz", "dryer_frequency", "dryer_hz"],
  reactorFrequency: ["reactor_frequency_hz", "reactor_frequency", "reactor_hz"],
} as const;

export interface ReadingsCsvRow {
  timestamp: Date;
  temperatureC: number | null;
  pressureBar: number | null;
  dryerFrequencyHz: number | null;
  reactorFrequencyHz: number | null;
}

export interface ParseReadingsCsvArgs {
  csvText: string;
  /** Inclusive lower bound (UTC). Readings before this are dropped. */
  runWindowStart: Date;
  /** Exclusive upper bound (UTC). Readings at/after this are dropped. */
  runWindowEnd: Date;
}

export interface ParseReadingsCsvResult {
  headers: string[];
  /** Rows with a valid timestamp (in or out of window). */
  parsedRows: number;
  /** Rows kept (valid timestamp AND inside the run window). */
  inWindowRows: number;
  /** Parsed rows dropped for being outside the run window. */
  droppedRows: number;
  /** Rows skipped for a missing/unparseable timestamp. */
  skippedRows: number;
  /**
   * In-window rows kept despite a blank or non-numeric required channel
   * (`temperature_c` or `pressure_bar`). Sensor dropouts (`---`) are legitimate
   * but the Isometric telemetry aggregator drops those values, so the count is
   * surfaced instead of hiding behind `inWindowRows`.
   */
  invalidRequiredRows: number;
  /**
   * The span the import should replace, derived from the kept readings
   * (min timestamp .. max timestamp + 1ms), clamped to the run window.
   * `null` when nothing landed in-window (import is then a no-op).
   */
  replacementWindow: { start: Date; end: Date } | null;
  /** Kept readings, chronologically sorted. */
  readings: ReadingsCsvRow[];
}

export function parseReadingsCsv(
  args: ParseReadingsCsvArgs,
): ParseReadingsCsvResult {
  if (args.runWindowStart >= args.runWindowEnd) {
    throw new Error(
      "This run has no time window (start time equals end time). Set the run's start and end times before importing readings.",
    );
  }

  const [rawHeaders, ...rows] = parseCsv(args.csvText);
  if (!rawHeaders?.length) {
    throw new Error("CSV file has no header row");
  }

  const headers = rawHeaders.map(normalizeHeader);
  const columns = resolveColumns(headers);

  const readings: ReadingsCsvRow[] = [];
  let parsedRows = 0;
  let skippedRows = 0;
  let droppedRows = 0;
  let invalidRequiredRows = 0;

  for (const rawRow of rows) {
    const row = padRow(rawRow, headers.length);
    const timeCell = row[columns.timestamp]?.trim() ?? "";
    if (!timeCell) {
      // A fully-blank line (e.g. a trailing newline) is ignored, but a row with
      // a blank timestamp and other populated cells is a real malformed row and
      // must be reported, not silently dropped.
      if (row.some((cell) => cell.trim() !== "")) skippedRows += 1;
      continue;
    }

    const timestamp = parseUtcTimestamp(timeCell);
    if (!timestamp) {
      skippedRows += 1;
      continue;
    }

    parsedRows += 1;
    if (timestamp < args.runWindowStart || timestamp >= args.runWindowEnd) {
      droppedRows += 1;
      continue;
    }

    const temperatureC = parseNumericCell(row[columns.temperature]);
    const pressureBar = parseNumericCell(row[columns.pressure]);
    // `temperature_c`/`pressure_bar` are canonically required, but the raw PLC
    // export writes momentary sensor dropouts as `---`/blank. Keep the row (a
    // per-channel null is what the aggregator expects) but count it so the
    // import summary does not overstate usable telemetry.
    if (temperatureC === null || pressureBar === null) {
      invalidRequiredRows += 1;
    }

    readings.push({
      timestamp,
      temperatureC,
      pressureBar,
      dryerFrequencyHz:
        columns.dryerFrequency == null
          ? null
          : parseNumericCell(row[columns.dryerFrequency]),
      reactorFrequencyHz:
        columns.reactorFrequency == null
          ? null
          : parseNumericCell(row[columns.reactorFrequency]),
    });
  }

  readings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return {
    headers,
    parsedRows,
    inWindowRows: readings.length,
    droppedRows,
    skippedRows,
    invalidRequiredRows,
    replacementWindow: buildReplacementWindow(readings),
    readings,
  };
}

interface ResolvedColumns {
  timestamp: number;
  temperature: number;
  pressure: number;
  dryerFrequency: number | null;
  reactorFrequency: number | null;
}

function resolveColumns(headers: string[]): ResolvedColumns {
  const timestamp = findColumn(headers, COLUMN_ALIASES.timestamp);
  const temperature = findColumn(headers, COLUMN_ALIASES.temperature);
  const pressure = findColumn(headers, COLUMN_ALIASES.pressure);

  const missing: string[] = [];
  if (timestamp < 0) missing.push("timestamp_utc");
  if (temperature < 0) missing.push("temperature_c");
  if (pressure < 0) missing.push("pressure_bar");
  if (missing.length > 0) {
    throw new Error(
      `The readings CSV is missing required ${pluralize(missing.length, "column")}: ${missing.join(", ")}. Found: ${
        headers.join(", ") || "(none)"
      }.`,
    );
  }

  const dryerFrequency = findColumn(headers, COLUMN_ALIASES.dryerFrequency);
  const reactorFrequency = findColumn(headers, COLUMN_ALIASES.reactorFrequency);

  return {
    timestamp,
    temperature,
    pressure,
    dryerFrequency: dryerFrequency >= 0 ? dryerFrequency : null,
    reactorFrequency: reactorFrequency >= 0 ? reactorFrequency : null,
  };
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  const lowered = headers.map((header) => header.toLowerCase());
  for (const alias of aliases) {
    const index = lowered.indexOf(alias);
    if (index >= 0) return index;
  }
  return -1;
}

function buildReplacementWindow(
  readings: ReadingsCsvRow[],
): { start: Date; end: Date } | null {
  if (readings.length === 0) return null;
  // Readings are sorted ascending by the caller.
  const start = readings[0]!.timestamp;
  const end = new Date(readings[readings.length - 1]!.timestamp.getTime() + 1);
  return { start, end };
}

/**
 * Parse a UTC timestamp. Accepts ISO-8601 with `Z` or a numeric offset
 * (`2026-04-02T22:15:00Z`, `...+00:00`), a space instead of `T`, and a
 * zone-less form which is interpreted as UTC (NOT the host's local zone —
 * that is the whole point of the `_utc` column). Returns `null` when the
 * value is not a recognisable timestamp.
 */
export function parseUtcTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      trimmed,
    );
  if (!match) return null;

  const [, y, mo, d, h, mi, s, ms, zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hours = Number(h);
  const minutes = Number(mi);
  const seconds = Number(s ?? "0");
  const millis = ms ? Number(ms.padEnd(3, "0")) : 0;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hours > 23 ||
    minutes > 59 ||
    seconds > 59
  ) {
    return null;
  }

  let utcMillis = Date.UTC(year, month - 1, day, hours, minutes, seconds, millis);

  // Guard against JS date rollover (e.g. 2026-02-30 -> Mar 2). This must run on
  // the calendar fields AS WRITTEN, before any offset shift — a valid offset
  // can legitimately move the instant onto a different UTC day, which is not a
  // rollover.
  const asWritten = new Date(utcMillis);
  if (
    asWritten.getUTCFullYear() !== year ||
    asWritten.getUTCMonth() !== month - 1 ||
    asWritten.getUTCDate() !== day
  ) {
    return null;
  }

  if (zone && zone.toUpperCase() !== "Z") {
    // Explicit numeric offset — shift to UTC. "+02:00" means local is ahead
    // of UTC, so subtract the offset to get the UTC instant.
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    const offsetHours = Number(digits.slice(0, 2));
    const offsetMinutesPart = Number(digits.slice(2, 4));
    // The regex only guarantees two digits per field, so reject an out-of-range
    // offset (e.g. `+99:99`) rather than producing the wrong instant.
    if (offsetHours > 23 || offsetMinutesPart > 59) return null;
    const offsetMinutes = sign * (offsetHours * 60 + offsetMinutesPart);
    utcMillis -= offsetMinutes * MS_PER_MINUTE;
  }

  return new Date(utcMillis);
}

function normalizeHeader(value: string): string {
  return value.replace(UTF8_BOM, "").trim();
}

function parseNumericCell(value: string | undefined): number | null {
  const normalized = value?.trim();
  if (!normalized || normalized === EMPTY_SENSOR_VALUE) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function padRow(row: string[], length: number): string[] {
  if (row.length >= length) return row;
  return [...row, ...Array.from({ length: length - row.length }, () => "")];
}

/** Minimal RFC-4180-ish CSV reader: quoted cells, escaped quotes, CRLF/CR. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.length > 1 || row[0]?.trim()) {
    rows.push(row);
  }

  return rows;
}
