import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const FILE_DATE_RE = /([A-Za-z0-9_-]+)[\s_-]+(\d{4}-\d{2}-\d{2})/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const EMPTY_SENSOR_VALUE = "---";
const UTF8_BOM = "\ufeff";
const HEADER_SIGNATURE_SEPARATOR = "\u001f";

const TEMPERATURE_HEADER_HINTS = ["carbonization outlet", "temperature"];
const PRESSURE_HEADER_HINTS = ["pressure"];
const GAS_FLOW_HEADER_HINTS = ["gas flow", "flow rate"];

export interface ReactorDayCsvMapping {
  temperature: string;
  pressure: string;
  gasFlow?: string | null;
}

export interface ReactorDayCsvReading {
  timestamp: Date;
  temperatureC: number | null;
  pressureBar: number | null;
  gasFlowRate: number | null;
}

export interface StoredReactorDayCsvMapping extends ReactorDayCsvMapping {
  headerSignature: string;
}

export interface InspectReactorDayCsvArgs {
  fileName: string;
  csvText: string;
  runReactorCode: string;
  storedMapping?: StoredReactorDayCsvMapping | null;
}

export interface InspectReactorDayCsvResult {
  fileReactorCode: string;
  fileDate: string;
  headers: string[];
  headerSignature: string;
  requiresMapping: boolean;
  suggestedMapping: ReactorDayCsvMapping;
  warnings: string[];
}

export interface ParseReactorDayCsvArgs {
  fileName: string;
  csvText: string;
  timezone: string;
  runWindowStart: Date;
  runWindowEnd: Date;
  mapping: ReactorDayCsvMapping;
}

export interface ParseReactorDayCsvResult {
  fileReactorCode: string;
  fileDate: string;
  headers: string[];
  replacementWindowStart: Date;
  replacementWindowEnd: Date;
  parsedRows: number;
  inWindowRows: number;
  droppedRows: number;
  readings: ReactorDayCsvReading[];
}

export interface ReactorDayCsvReplacementWindowArgs {
  fileDate: string;
  timezone: string;
  runWindowStart: Date;
  runWindowEnd: Date;
}

export function inspectReactorDayCsv(
  args: InspectReactorDayCsvArgs,
): InspectReactorDayCsvResult {
  const metadata = parseFilenameMetadata(args.fileName);
  const [rawHeaders] = parseCsv(args.csvText);
  if (!rawHeaders?.length) {
    throw new Error("CSV file has no header row");
  }

  const headers = rawHeaders.map(normalizeHeader);
  const headerSignature = buildHeaderSignature(headers);
  const storedMapping = args.storedMapping ?? null;
  const requiresHeaderMapping =
    !storedMapping || storedMapping.headerSignature !== headerSignature;
  const hasReactorMismatch =
    metadata.fileReactorCode.toLowerCase() !== args.runReactorCode.toLowerCase()
  const warnings = hasReactorMismatch
    ? [
        `Filename reactor ${metadata.fileReactorCode} does not match selected run reactor ${args.runReactorCode}. Confirm this is the correct reactor-day file before importing.`,
      ]
    : [];

  return {
    ...metadata,
    headers,
    headerSignature,
    requiresMapping: requiresHeaderMapping || hasReactorMismatch,
    suggestedMapping: requiresHeaderMapping
      ? suggestMapping(headers)
      : {
          temperature: storedMapping.temperature,
          pressure: storedMapping.pressure,
          gasFlow: storedMapping.gasFlow,
        },
    warnings,
  };
}

export function parseReactorDayCsv(
  args: ParseReactorDayCsvArgs,
): ParseReactorDayCsvResult {
  const metadata = parseFilenameMetadata(args.fileName);
  const [rawHeaders, ...rows] = parseCsv(args.csvText);
  if (!rawHeaders?.length) {
    throw new Error("CSV file has no header row");
  }

  const headers = rawHeaders.map(normalizeHeader);
  const indexes = resolveMappingIndexes(headers, args.mapping);
  const timeIndex = findHeaderIndex(headers, "Time");
  if (timeIndex < 0) {
    throw new Error("CSV file must include a Time column");
  }
  const replacementWindow = getReactorDayCsvReplacementWindow({
    fileDate: metadata.fileDate,
    timezone: args.timezone,
    runWindowStart: args.runWindowStart,
    runWindowEnd: args.runWindowEnd,
  });

  const readings: ReactorDayCsvReading[] = [];
  let parsedRows = 0;

  for (const rawRow of rows) {
    const row = padRow(rawRow, headers.length);
    const timeCell = row[timeIndex]?.trim() ?? "";
    if (!timeCell) continue;

    const time = parseTimeCell(timeCell);
    if (!time) continue;

    parsedRows += 1;
    const timestamp = fromZonedTime(
      `${metadata.fileDate}T${time}`,
      args.timezone,
    );
    if (timestamp < args.runWindowStart || timestamp >= args.runWindowEnd) {
      continue;
    }

    readings.push({
      timestamp,
      temperatureC: parseNumericCell(row[indexes.temperature]),
      pressureBar: parseNumericCell(row[indexes.pressure]),
      gasFlowRate:
        indexes.gasFlow == null ? null : parseNumericCell(row[indexes.gasFlow]),
    });
  }

  return {
    ...metadata,
    headers,
    replacementWindowStart: replacementWindow.start,
    replacementWindowEnd: replacementWindow.end,
    parsedRows,
    inWindowRows: readings.length,
    droppedRows: parsedRows - readings.length,
    readings,
  };
}

export function getReactorDayCsvReplacementWindow(
  args: ReactorDayCsvReplacementWindowArgs,
): { start: Date; end: Date } {
  const fileDayStart = fromZonedTime(`${args.fileDate}T00:00:00`, args.timezone);
  const fileDayEnd = fromZonedTime(
    `${addIsoDateDays(args.fileDate, 1)}T00:00:00`,
    args.timezone,
  );
  const start =
    args.runWindowStart > fileDayStart ? args.runWindowStart : fileDayStart;
  const end = args.runWindowEnd < fileDayEnd ? args.runWindowEnd : fileDayEnd;

  if (start >= end) {
    throw new Error(
      `CSV file date ${args.fileDate} is outside the selected production run window ${formatRunWindowForMessage(args.runWindowStart, args.runWindowEnd, args.timezone)}. Select a production run that covers ${args.fileDate}, or update the run start/end times.`,
    );
  }

  return { start, end };
}

function formatRunWindowForMessage(
  start: Date,
  end: Date,
  timezone: string,
): string {
  const formattedStart = formatInTimeZone(start, timezone, "yyyy-MM-dd HH:mm");
  const formattedEnd = formatInTimeZone(end, timezone, "yyyy-MM-dd HH:mm");
  return `${formattedStart} - ${formattedEnd} (${timezone})`;
}

function addIsoDateDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

export function parseFilenameMetadata(fileName: string): {
  fileReactorCode: string;
  fileDate: string;
} {
  const match = FILE_DATE_RE.exec(fileName);
  if (!match) {
    throw new Error(
      "Filename must include reactor code and date, for example TZ001B 2026-04-02.csv",
    );
  }
  return {
    fileReactorCode: match[1]!,
    fileDate: match[2]!,
  };
}

function resolveMappingIndexes(
  headers: string[],
  mapping: ReactorDayCsvMapping,
): {
  temperature: number;
  pressure: number;
  gasFlow: number | null;
} {
  const temperature = findHeaderIndex(headers, mapping.temperature);
  const pressure = findHeaderIndex(headers, mapping.pressure);
  const gasFlow = mapping.gasFlow ? findHeaderIndex(headers, mapping.gasFlow) : -1;

  const missing: string[] = [];
  if (temperature < 0) missing.push(mapping.temperature);
  if (pressure < 0) missing.push(mapping.pressure);
  if (mapping.gasFlow && gasFlow < 0) missing.push(mapping.gasFlow);
  if (missing.length > 0) {
    throw new Error(`CSV file is missing mapped columns: ${missing.join(", ")}`);
  }

  return {
    temperature,
    pressure,
    gasFlow: gasFlow >= 0 ? gasFlow : null,
  };
}

function findHeaderIndex(headers: string[], name: string): number {
  const needle = normalizeHeader(name).toLowerCase();
  return headers.findIndex((header) => header.toLowerCase() === needle);
}

function normalizeHeader(value: string): string {
  return value.replace(UTF8_BOM, "").trim();
}

function buildHeaderSignature(headers: string[]): string {
  return headers
    .map((header) => header.trim().toLowerCase())
    .join(HEADER_SIGNATURE_SEPARATOR);
}

function suggestMapping(headers: string[]): ReactorDayCsvMapping {
  return {
    temperature: suggestHeader(headers, TEMPERATURE_HEADER_HINTS) ?? "",
    pressure: suggestHeader(headers, PRESSURE_HEADER_HINTS) ?? "",
    gasFlow: suggestHeader(headers, GAS_FLOW_HEADER_HINTS) ?? null,
  };
}

function suggestHeader(
  headers: string[],
  hints: readonly string[],
): string | null {
  const lowered = headers.map((header) => ({
    header,
    lower: header.toLowerCase(),
  }));

  const exact = lowered.find(({ lower }) =>
    hints.every((hint) => lower.includes(hint)),
  );
  if (exact) return exact.header;

  const partial = lowered.find(({ lower }) =>
    hints.some((hint) => lower.includes(hint)),
  );
  return partial?.header ?? null;
}

function parseTimeCell(value: string): string | null {
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? "0");
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return [
    hours.toString().padStart(2, "0"),
    minutes.toString().padStart(2, "0"),
    seconds.toString().padStart(2, "0"),
  ].join(":");
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
