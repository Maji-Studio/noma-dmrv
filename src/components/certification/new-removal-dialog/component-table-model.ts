/**
 * What a Removal sends per template component, shaped for the one component
 * table of the submit step. Figures come from the compiled review (the
 * Removal-scoped inputs the submission will post, as the technical drawer lists
 * them): never from batch-wide automatic figures, which count shipments and
 * production this Removal does not send. Entry counts, files and blockers come
 * from the server's per-batch lines (`ctx.emissionLinesByBatchId`).
 *
 * Every row is in exactly one state: Included, Blocked (the submission cannot
 * send it until something is fixed), Sent earlier (an earlier Removal holds the
 * batches' production emissions claim, so this production component is left
 * out) or In another Removal (an entry held by another Removal, which may still
 * be in progress, takes the component out). They read differently on purpose.
 */
import {
  displayUnit,
  formatMagnitude,
  hasRecordsFigure,
  manualEntriesText,
} from "@/components/emissions/emission-line-display";
import type { RemovalCompilationView } from "@/fn/certification";
import type { MemberCreditBatch } from "@/fn/certification/certify-context";
import type { RemovalLedgerPreview } from "@/fn/certification/removal-ledger-preview";
import type { BatchEmissionLine } from "@/lib/certification/emission-lines";
import {
  OPEN_REMOVAL_TEMPLATES_LINK_LABEL,
  removalTemplatesSettingsHref,
} from "@/lib/certification/links";
import { removalFindingFixLink } from "@/lib/certification/removal-finding-links";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { SOURCE_IDS, type AutomaticSourceId } from "@/lib/isometric/template-observations/catalog-sources";
import { SOURCE_BUCKETS } from "@/lib/isometric/utils/aggregation";

export const SENT_SOURCE = {
  automatic: "Automatic datapoints",
  zero: "Recorded zero",
  none: "None",
  samples: "Samples",
  template: "Set in the template",
} as const;

/** Where the CO₂ stored component's figure lives: in the estimate above the table. */
export const ESTIMATE_POINTER = "In the CO₂e estimate";
const UNBINDABLE_REASON =
  "noma cannot submit this component. Review the Removal template.";

export type ComponentState = "included" | "blocked" | "earlier" | "elsewhere";

export interface ComponentFix {
  label: string;
  href: string;
  /** The credit batch the fix is about, or null for a template-wide fix. */
  batchCode: string | null;
}

export interface ComponentBlocker {
  message: string;
  batchCodes: string[];
  fixes: ComponentFix[];
}

export interface ComponentRow {
  componentId: string;
  name: string;
  groupKey: string;
  groupName: string;
  state: ComponentState;
  /** Where the figure comes from. Empty when the state already says all there is to say. */
  source: string;
  /** The figure sent, a pointer or a reason it has none. Null leaves the cell empty (or pending while the table loads). */
  figure: { text: string; quiet: boolean } | null;
  fileCount: number;
  /** Entries holding files, to read their names on demand. */
  fileEntryIds: string[];
  /** Blocked only: each distinct blocker, with its credit batches and its fix. */
  blocked: { items: ComponentBlocker[] } | null;
}

export interface ComponentBatch {
  id: string;
  code: string;
  startDate: string | null;
  endDate: string | null;
  dryTons: number;
  /** The production emissions claim: in this Removal, or sent with an earlier one. */
  claim:
    | { kind: "here" }
    | { kind: "earlier"; removalId: string | null; removalCode: string | null }
    | null;
}

export interface ComponentTable {
  /** The compiled review is still being prepared: figures and states are not final. */
  loading: boolean;
  batches: ComponentBatch[];
  rows: ComponentRow[];
  groups: Array<{ key: string; label: string; rows: ComponentRow[] }>;
}

export interface ComponentTableInput {
  batches: readonly MemberCreditBatch[];
  linesByBatchId: Record<string, readonly BatchEmissionLine[]> | undefined;
  /** The compiled review; null while it is not ready. */
  review: RemovalCompilationView["review"] | null;
  /** The review is still being prepared: figures are not known yet. */
  isLoading: boolean;
  /** Components the template cannot submit. */
  unbindableComponentIds?: ReadonlySet<string>;
  ledger: Pick<RemovalLedgerPreview, "claims" | "inputs">;
  facilityId: string;
}

type Binding = NonNullable<RemovalCompilationView["review"]>["bindings"][number];

function figureText(binding: Binding): string | null {
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

/**
 * Why an automatic input has no figure, where the code knows: a required
 * transport category with no legs, or legs that cannot be summed. The ledger
 * names its transport inputs by category; the template's sources by purpose.
 */
const LEDGER_INPUT_FOR_SOURCE: Partial<Record<AutomaticSourceId, string>> = {
  "feedstock-transport": "feedstock-transport",
  "delivery-transport": "biochar-transport",
};

function figureGap(
  lines: readonly BatchEmissionLine[],
  ledgerInputs: ComponentTableInput["ledger"]["inputs"],
): string | null {
  for (const line of lines) {
    const source = line.contract?.automaticSource;
    const ledgerId = source ? LEDGER_INPUT_FOR_SOURCE[source] : undefined;
    if (!ledgerId) continue;
    const gap = ledgerInputs.find((input) => input.id === ledgerId)?.missingReason;
    if (gap) return gap;
  }
  return null;
}

const PRODUCTION_SOURCES: ReadonlySet<string> = new Set(
  (Object.keys(SOURCE_IDS) as Array<keyof typeof SOURCE_IDS>)
    .filter((key) => key in SOURCE_BUCKETS && SOURCE_BUCKETS[key as keyof typeof SOURCE_BUCKETS] === "production")
    .map((key) => SOURCE_IDS[key]),
);

/**
 * Why the submission leaves a component out. When every batch's production
 * emissions are claimed by an earlier Removal, its production components are
 * left out: those were sent earlier. Any other omission comes from an entry
 * another Removal holds (possibly still in progress), so nothing was sent yet.
 */
function omissionState(
  lines: readonly BatchEmissionLine[],
  claims: ComponentTableInput["ledger"]["claims"],
): "earlier" | "elsewhere" {
  const claimedEarlier = claims.length > 0 && claims.every((claim) => claim.contribution === "delivery-only");
  const production = lines.some((line) => {
    const source = line.contract?.automaticSource;
    return source !== undefined && PRODUCTION_SOURCES.has(source);
  });
  return claimedEarlier && production ? "earlier" : "elsewhere";
}

function blockedItems(
  entries: Array<{ batch: MemberCreditBatch; line: BatchEmissionLine }>,
  input: ComponentTableInput,
  unbindable: boolean,
): ComponentBlocker[] {
  const byMessage = new Map<string, ComponentBlocker>();
  for (const { batch, line } of entries) {
    if (!line.blocker) continue;
    const item = byMessage.get(line.blocker.message) ?? { message: line.blocker.message, batchCodes: [], fixes: [] };
    if (!item.batchCodes.includes(batch.code)) item.batchCodes.push(batch.code);
    const link = removalFindingFixLink(line.blocker, input.facilityId, [batch.id]);
    if (link && !item.fixes.some((fix) => fix.href === link.href)) {
      item.fixes.push({ label: link.label, href: link.href, batchCode: input.batches.length > 1 ? batch.code : null });
    }
    byMessage.set(line.blocker.message, item);
  }
  const items = [...byMessage.values()];
  if (unbindable) {
    items.push({
      message: UNBINDABLE_REASON,
      batchCodes: [],
      fixes: [{ label: OPEN_REMOVAL_TEMPLATES_LINK_LABEL, href: removalTemplatesSettingsHref(input.facilityId), batchCode: null }],
    });
  }
  return items;
}

/** One row per template component, in template order, for the whole Removal. */
export function componentRows(input: ComponentTableInput): ComponentRow[] {
  const byComponent = new Map<string, Array<{ batch: MemberCreditBatch; line: BatchEmissionLine }>>();
  for (const batch of input.batches) {
    for (const line of input.linesByBatchId?.[batch.id] ?? []) {
      byComponent.set(line.componentId, [...(byComponent.get(line.componentId) ?? []), { batch, line }]);
    }
  }
  const omitted = new Set(input.review?.omittedComponentIds ?? []);

  return [...byComponent.values()].map((entries) => {
    const lines = entries.map((entry) => entry.line);
    const first = lines[0];
    const base = {
      componentId: first.componentId,
      name: first.displayName,
      groupKey: first.groupKey,
      groupName: first.groupName,
    };
    const parts = sourceParts(lines);
    const bindings = (input.review?.bindings ?? []).filter(
      (binding) => binding.componentId === first.componentId,
    );
    const fixed = bindings.some((binding) => binding.binding === "fixed");

    if (omitted.has(first.componentId)) {
      return {
        ...base, state: omissionState(lines, input.ledger.claims), source: "", figure: null, fileCount: 0,
        fileEntryIds: [], blocked: null,
      };
    }

    const unbindable = input.unbindableComponentIds?.has(first.componentId) ?? false;
    if (unbindable || entries.some((entry) => entry.line.blocker)) {
      return {
        ...base, state: "blocked" as const, source: parts.join(", "), figure: null, fileCount: 0,
        fileEntryIds: [], blocked: { items: blockedItems(entries, input, unbindable) },
      };
    }

    const files = filesOf(lines);
    const included = { ...base, state: "included" as const, fileCount: files.count,
      fileEntryIds: files.entryIds, blocked: null };

    if (input.isLoading) {
      // Figures are not known yet: the cell stays pending, never a settled "not computed".
      return { ...included, source: parts.join(", "), figure: null };
    }
    if (lines.some((line) => line.contract?.automaticSource === "sequestration")) {
      // Compiled from Samples and applications, inside the estimate above the table.
      return { ...included, source: SENT_SOURCE.samples, figure: { text: ESTIMATE_POINTER, quiet: true } };
    }
    // The quantities the operator's records supply. Fixed datapoints (emission
    // factors, warming potentials) only stand in when the component has no such input.
    const monitored = bindings.filter((binding) => binding.binding === "monitored");
    const shown = monitored.length > 0
      ? monitored
      : bindings.filter((binding) => binding.binding === "fixed");
    const figures = shown
      .map(figureText)
      .filter((value): value is string => value !== null);
    const gap = figures.length === 0 ? figureGap(lines, input.ledger.inputs) : null;
    return {
      ...included,
      source: parts.length ? parts.join(", ") : fixed ? SENT_SOURCE.template : SENT_SOURCE.none,
      // No figure and no known reason: the cell stays empty, since the source says what feeds it.
      figure: figures.length
        ? { text: figures.join(", "), quiet: false }
        : gap
          ? { text: gap, quiet: true }
          : null,
    };
  });
}

export function groupRows(rows: readonly ComponentRow[]) {
  const groups = new Map<string, { key: string; label: string; rows: ComponentRow[] }>();
  for (const row of rows) {
    const group = groups.get(row.groupKey);
    if (group) group.rows.push(row);
    else groups.set(row.groupKey, { key: row.groupKey, label: row.groupName, rows: [row] });
  }
  return [...groups.values()];
}

/** What `compileRemovalSubmission` returns when the build fails: a review with nothing in it. */
function isEmptyReview(review: NonNullable<RemovalCompilationView["review"]>): boolean {
  return review.memberCreditBatches?.length === 0 && review.bindings.length === 0;
}

/** The table's batches, each with its production claim, and its rows. Rows wait for the compiled review. */
export function buildComponentTable(input: ComponentTableInput): ComponentTable {
  const claimByBatch = new Map(input.ledger.claims.map((claim) => [claim.creditBatchId, claim]));
  const batches = input.batches.map((batch): ComponentBatch => {
    const claim = claimByBatch.get(batch.id);
    return {
      id: batch.id,
      code: batch.code,
      startDate: batch.startDate,
      endDate: batch.endDate,
      dryTons: batch.appliedDryWeightTons,
      claim: !claim
        ? null
        : claim.contribution === "production-and-delivery"
          ? { kind: "here" }
          : { kind: "earlier", removalId: claim.claimingRemovalId, removalCode: claim.claimingRemovalCode },
    };
  });
  // Without a compiled review, or after a failed build (which returns a review
  // with no members and no bindings), nothing is known about what is sent.
  const compiled = input.review && !isEmptyReview(input.review) ? input.review : null;
  const rows = compiled || input.isLoading ? componentRows({ ...input, review: compiled }) : [];
  return { loading: input.isLoading, batches, rows, groups: groupRows(rows) };
}
