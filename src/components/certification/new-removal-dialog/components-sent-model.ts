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
  samples: "Samples",
  template: "Set in the template",
  notSent: "Not sent",
} as const;

export const CARBON_LEDGER_POINTER = "See Carbon ledger";
const UNBINDABLE_REASON =
  "noma cannot submit this component. Review the Removal template.";

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
  /** Why the component is not sent (a blocker or no mapping), or null when it is. */
  notSentReason: string | null;
}

export interface SentRowContext {
  /** Components whose datapoints are fixed in the template and sent with it. */
  fixedComponentIds?: ReadonlySet<string>;
  /** Components the template cannot submit. */
  unbindableComponentIds?: ReadonlySet<string>;
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

function isSequestration(line: BatchEmissionLine): boolean {
  return line.contract?.automaticSource === "sequestration";
}

function notSentReason(line: BatchEmissionLine, context: SentRowContext): string | null {
  if (line.blocker) return line.blocker.message;
  if (context.unbindableComponentIds?.has(line.componentId)) return UNBINDABLE_REASON;
  return null;
}

export function sentComponentRows(
  lines: readonly BatchEmissionLine[],
  context: SentRowContext = {},
): SentComponentRow[] {
  return lines.map((line) => {
    const withFiles = countingValues(line).filter(
      (entry) => (entry.documentCount ?? 0) > 0 && entry.id,
    );
    const reason = notSentReason(line, context);
    let source = sourceText(line);
    let value = valueText(line);
    if (reason) {
      // A component the submission cannot send must not read as sent.
      source = SENT_SOURCE.notSent;
      value = SENT_SOURCE.notSent;
    } else if (isSequestration(line)) {
      // Compiled from Samples and applications, shown in the Carbon ledger.
      source = SENT_SOURCE.samples;
      value = CARBON_LEDGER_POINTER;
    } else if (source === SENT_SOURCE.none && context.fixedComponentIds?.has(line.componentId)) {
      source = SENT_SOURCE.template;
      value = SENT_SOURCE.template;
    }
    const pointer = value === CARBON_LEDGER_POINTER || value === SENT_SOURCE.template;
    return {
      componentId: line.componentId,
      name: line.displayName,
      groupKey: line.groupKey,
      groupName: line.groupName,
      value,
      valueMissing:
        pointer ||
        !!reason ||
        value === MISSING_VALUE.notAvailable ||
        value === MISSING_VALUE.notRecorded,
      source,
      fileCount: reason
        ? 0
        : withFiles.reduce((sum, entry) => sum + (entry.documentCount ?? 0), 0),
      fileEntryIds: reason ? [] : withFiles.map((entry) => entry.id!),
      notSentReason: reason,
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
