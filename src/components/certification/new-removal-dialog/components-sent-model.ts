/**
 * What a Removal sends per template component, read from the lines the server
 * already derived for the submission (`ctx.emissionLinesByBatchId`): the same
 * facts the submit gate uses, never recomputed from raw records here.
 */
import {
  formatFigure,
  hasRecordsFigure,
  manualEntriesText,
} from "@/components/emissions/emission-line-display";
import type { BatchEmissionLine } from "@/lib/certification/emission-lines";
import { MISSING_VALUE } from "@/lib/copy-utils";

export const SENT_SOURCE = {
  automatic: "Automatic datapoints",
  zero: "Recorded zero",
  none: "None",
} as const;

export interface SentComponentRow {
  componentId: string;
  name: string;
  groupKey: string;
  groupName: string;
  /** The figure sent, or a missing-value token. */
  value: string;
  /** True when `value` is a token, not a figure. */
  valueMissing: boolean;
  source: string;
  fileCount: number;
  /** Entries holding files, to read their names on demand. */
  fileEntryIds: string[];
}

function countingValues(line: BatchEmissionLine) {
  return line.entries.filter((entry) => entry.kind === "value" && entry.counts);
}

export function sourceText(line: BatchEmissionLine): string {
  if (line.state === "confirmedZero") return SENT_SOURCE.zero;
  const automatic =
    hasRecordsFigure(line.records) || line.automaticFigure !== null;
  const manual = countingValues(line).length;
  if (automatic && manual) {
    return `${SENT_SOURCE.automatic}, ${manualEntriesText(manual)}`;
  }
  if (automatic) return SENT_SOURCE.automatic;
  if (manual) return manualEntriesText(manual);
  return SENT_SOURCE.none;
}

function valueText(line: BatchEmissionLine): string {
  if (line.total) return formatFigure(line.total);
  if (line.state === "confirmedZero") return "0";
  const recorded =
    hasRecordsFigure(line.records) ||
    line.entries.some((entry) => entry.kind === "value");
  return recorded ? MISSING_VALUE.notAvailable : MISSING_VALUE.notRecorded;
}

export function sentComponentRows(
  lines: readonly BatchEmissionLine[],
): SentComponentRow[] {
  return lines.map((line) => {
    const withFiles = countingValues(line).filter(
      (entry) => (entry.documentCount ?? 0) > 0 && entry.id,
    );
    const value = valueText(line);
    return {
      componentId: line.componentId,
      name: line.displayName,
      groupKey: line.groupKey,
      groupName: line.groupName,
      value,
      valueMissing: value === MISSING_VALUE.notAvailable || value === MISSING_VALUE.notRecorded,
      source: sourceText(line),
      fileCount: withFiles.reduce(
        (sum, entry) => sum + (entry.documentCount ?? 0),
        0,
      ),
      fileEntryIds: withFiles.map((entry) => entry.id!),
    };
  });
}

export function groupSentRows(rows: readonly SentComponentRow[]) {
  const groups = new Map<
    string,
    { key: string; label: string; rows: SentComponentRow[] }
  >();
  for (const row of rows) {
    const group = groups.get(row.groupKey);
    if (group) group.rows.push(row);
    else
      groups.set(row.groupKey, {
        key: row.groupKey,
        label: row.groupName,
        rows: [row],
      });
  }
  return [...groups.values()];
}
