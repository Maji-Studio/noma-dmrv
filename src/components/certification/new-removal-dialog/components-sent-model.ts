/**
 * What a Removal sends per template component. Figures come from the compiled
 * review (the Removal-scoped inputs the submission will post, as the technical
 * drawer lists them): never from batch-wide automatic figures, which count
 * shipments and production this Removal does not send. Entry counts and files
 * come from the server's per-batch lines (`ctx.emissionLinesByBatchId`).
 */
import {
  displayUnit,
  formatMagnitude,
  hasRecordsFigure,
  manualEntriesText,
} from "@/components/emissions/emission-line-display";
import type { RemovalCompilationView } from "@/fn/certification";
import type { BatchEmissionLine } from "@/lib/certification/emission-lines";

export const SENT_SOURCE = {
  automatic: "Automatic datapoints",
  zero: "Recorded zero",
  none: "None",
  samples: "Samples",
  template: "Set in the template",
  notSent: "Not sent",
} as const;

export const CARBON_LEDGER_POINTER = "See Carbon ledger";
const EARLIER_REMOVAL_REASON = "Sent with an earlier Removal.";
const UNBINDABLE_REASON =
  "noma cannot submit this component. Review the Removal template.";

export interface SentComponentRow {
  componentId: string;
  name: string;
  groupKey: string;
  groupName: string;
  /** What the source column says. A component not sent says only that, once. */
  source: string;
  /** The figure sent, or null when there is none to show. */
  value: string | null;
  /** True when `value` points elsewhere instead of giving a figure. */
  valuePointer: boolean;
  fileCount: number;
  /** Entries holding files, to read their names on demand. */
  fileEntryIds: string[];
  /** Why the component is not sent, or null when it is. */
  notSentReason: string | null;
}

export interface SentRowContext {
  /** The compiled review; null while it is not ready. */
  review?: RemovalCompilationView["review"] | null;
  /** Components the template cannot submit. */
  unbindableComponentIds?: ReadonlySet<string>;
}

type Binding = NonNullable<RemovalCompilationView["review"]>["bindings"][number];

function figure(binding: Binding): string | null {
  if (binding.wireMagnitude === undefined) return null;
  return `${formatMagnitude(binding.wireMagnitude)} ${displayUnit(binding.wireUnit)}`.trim();
}

function sourceParts(lines: readonly BatchEmissionLine[]): string[] {
  const automatic = lines.some(
    (line) => hasRecordsFigure(line.records) || line.automaticFigure !== null,
  );
  const manual = lines.reduce(
    (sum, line) =>
      sum + line.entries.filter((entry) => entry.kind === "value" && entry.counts).length,
    0,
  );
  const zero = lines.some((line) => line.state === "confirmedZero");
  return [
    ...(automatic ? [SENT_SOURCE.automatic] : []),
    ...(manual > 0 ? [manualEntriesText(manual)] : []),
    ...(zero ? [SENT_SOURCE.zero] : []),
  ];
}

function filesOf(lines: readonly BatchEmissionLine[]) {
  const withFiles = lines.flatMap((line) =>
    line.entries.filter(
      (entry) =>
        entry.kind === "value" && entry.counts && (entry.documentCount ?? 0) > 0 && entry.id,
    ),
  );
  return {
    count: withFiles.reduce((sum, entry) => sum + (entry.documentCount ?? 0), 0),
    entryIds: withFiles.map((entry) => entry.id!),
  };
}

/** One row per template component, in template order, for the whole Removal. */
export function sentComponentRows(
  batchLines: readonly (readonly BatchEmissionLine[])[],
  context: SentRowContext = {},
): SentComponentRow[] {
  const byComponent = new Map<string, BatchEmissionLine[]>();
  for (const lines of batchLines) {
    for (const line of lines) {
      byComponent.set(line.componentId, [...(byComponent.get(line.componentId) ?? []), line]);
    }
  }
  const omitted = new Set(context.review?.omittedComponentIds ?? []);
  return [...byComponent.values()].map((lines) => {
    const first = lines[0];
    const bindings = (context.review?.bindings ?? []).filter(
      (binding) => binding.componentId === first.componentId,
    );
    const blocker = lines.find((line) => line.blocker)?.blocker?.message;
    const reason = omitted.has(first.componentId)
      ? EARLIER_REMOVAL_REASON
      : (blocker ??
        (context.unbindableComponentIds?.has(first.componentId) ? UNBINDABLE_REASON : null));
    const base = {
      componentId: first.componentId,
      name: first.displayName,
      groupKey: first.groupKey,
      groupName: first.groupName,
    };
    if (reason) {
      // A component the submission cannot send must not read as sent.
      return { ...base, source: SENT_SOURCE.notSent, value: null, valuePointer: false,
        fileCount: 0, fileEntryIds: [], notSentReason: reason };
    }
    const files = filesOf(lines);
    const common = { ...base, fileCount: files.count, fileEntryIds: files.entryIds, notSentReason: null };
    if (lines.some((line) => line.contract?.automaticSource === "sequestration")) {
      // Compiled from Samples and applications, shown in the Carbon ledger.
      return { ...common, source: SENT_SOURCE.samples, value: CARBON_LEDGER_POINTER, valuePointer: true };
    }
    const figures = bindings
      .filter((binding) => binding.binding !== "measurement-sample")
      .map(figure)
      .filter((value): value is string => value !== null);
    const parts = sourceParts(lines);
    const fixed = bindings.some((binding) => binding.binding === "fixed");
    return {
      ...common,
      source: parts.length ? parts.join(", ") : fixed ? SENT_SOURCE.template : SENT_SOURCE.none,
      value: figures.length ? figures.join(", ") : null,
      valuePointer: false,
    };
  });
}

export function groupSentRows(rows: readonly SentComponentRow[]) {
  const groups = new Map<string, { key: string; label: string; rows: SentComponentRow[] }>();
  for (const row of rows) {
    const group = groups.get(row.groupKey);
    if (group) group.rows.push(row);
    else groups.set(row.groupKey, { key: row.groupKey, label: row.groupName, rows: [row] });
  }
  return [...groups.values()];
}
