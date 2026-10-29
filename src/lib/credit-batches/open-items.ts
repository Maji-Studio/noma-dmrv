import { recordHref } from "@/lib/record-links";
import { MIN_VISIBLE_NOT_APPLIED_DRY_KG } from "./application-mass";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import type { CreditBatchMissingProductionRuns } from "@/data-access/credit-batch-missing-production-runs";
import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  O_TO_C_ORG_ELIGIBILITY_MAX,
  isUsableRatio,
} from "@/lib/calculations/biochar-eligibility";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import type { BatchHealth, BatchHealthFixTarget } from "@/lib/certification/batch-health";
import {
  certCheckLabel,
  linesDecidedByAdmin,
} from "@/lib/certification/requirement-labels";
import {
  batchHealthFixLinkFor,
  resolveBatchHealthFixTarget,
} from "@/lib/certification/batch-health-links";
import type {
  DurabilityBatchSummary,
  DurabilitySummaryReplicate,
} from "@/lib/certification/durability-batch-summary";
import { EMISSION_LINE_STATE_LABELS, type BatchEmissionLine } from "@/lib/certification/emission-lines";
import type { SampleDocumentWarningKey } from "@/lib/certification/sample-document-warnings";
import { RETURNED_BY_ISOMETRIC_LABEL } from "@/lib/certification/emission-entry-messages";
import type { RemovalCorrection } from "@/lib/certification/removal-entry-correction";
import { ENTITY_FOCUS_TARGETS } from "@/lib/entity-deep-link";
import { formatCalendarDate, formatTonnes } from "@/lib/format-utils";
import { lateRunEntryDate } from "./late-run-entry-date";
import { RESUBMIT_NEEDED_LABEL, changedComponentNames, correctionStatementLabel, joinWithAnd, returnedStatementPhrase, comparisonUnavailableClause } from "@/lib/removal-correction-copy";
import { lateEntryView, waitingDetail, waitingEntryTitle } from "@/lib/certification/late-entry-view";
import { ghgStatementPeriodLabel } from "./ghg-statement-period-label";

// Five kg rounds up to the smallest visible amount at two-decimal tonne precision.
export { MIN_VISIBLE_NOT_APPLIED_DRY_KG } from "./application-mass";

/** Overview rows a health check lands on: the Removal template block and the batch details. */
export const CREDIT_BATCH_TEMPLATE_ROW = ENTITY_FOCUS_TARGETS.removalTemplate;
export const CREDIT_BATCH_DETAILS_ROW = "batch-details";
export const MISSING_PRODUCTION_RUN_ITEM_PREFIX = "missing-production-run:";
/** Emissions Checks for Sent batches' late runs and held runs that Add run refuses. */
export const LATE_PRODUCTION_RUN_ITEM_PREFIX = "late-production-run:";

export interface CreditBatchOpenItem {
  id: string;
  title: string;
  /** The title text after the linked production run code. */
  titleAfterCode?: string;
  detail?: string;
  /** The protocol reasoning behind a requirement, shown behind an ⓘ. */
  why?: string;
  /** The run a missing-run Check names, so other surfaces can link its code. */
  productionRun?: { id: string; code: string };
  /** Missing-run Check only: a later Emissions entry dated the run's day may already record its emissions. */
  sameDayEntry?: boolean;
  /** Where the row leads; null when the viewer can't act on it (a member and components to decide). */
  target:
    | { tab: "overview" | "production" | "samples" | "emissions" | "removals"; rowId?: string }
    | { href: string }
    | null;
}

export interface CreditBatchOpenItemsInput {
  facilityId: string;
  creditBatchId: string;
  health?: BatchHealth;
  durability?: DurabilityBatchSummary;
  emissionLines?: readonly BatchEmissionLine[];
  missingProductionRuns?: CreditBatchMissingProductionRuns;
  /** Admin. Members get no link to decide components, which only Admins can do. */
  canManage: boolean;
}

function outlierTitle(replicate: DurabilitySummaryReplicate): string {
  const limits: string[] = [];
  if (isUsableRatio(replicate.hToCorg) && replicate.hToCorg >= H_TO_C_ORG_ELIGIBILITY_MAX) {
    const comparison = replicate.hToCorg === H_TO_C_ORG_ELIGIBILITY_MAX ? "at" : "above";
    limits.push(`H/Corg ${comparison} the ${H_TO_C_ORG_ELIGIBILITY_MAX} limit`);
  }
  if (isUsableRatio(replicate.oToCorg) && replicate.oToCorg >= O_TO_C_ORG_ELIGIBILITY_MAX) {
    const comparison = replicate.oToCorg === O_TO_C_ORG_ELIGIBILITY_MAX ? "at" : "above";
    limits.push(`O/Corg ${comparison} the ${O_TO_C_ORG_ELIGIBILITY_MAX} limit`);
  }
  return limits.length
    ? `Sample ${replicate.sampleCode}: ${limits.join(" and ")}`
    : `Sample ${replicate.sampleCode} is outside the durability limits`;
}

/** Non-blocking Sample document gaps, worded as Check items on the Samples tab. */
const DOCUMENT_WARNING_ITEMS: Record<SampleDocumentWarningKey, CreditBatchOpenItem> = {
  labReport: {
    id: "document:lab-report",
    title: "No lab report on any Sample",
    detail: "Upload a lab report to one of its Samples. You can still submit the Removal.",
    target: { tab: "samples" },
  },
  reflectanceHistogram: {
    id: "document:reflectance-histogram",
    title: "No reflectance histogram on any Sample",
    detail: "Upload a reflectance histogram to one of its Samples. You can still submit the Removal.",
    target: { tab: "samples" },
  },
};

/**
 * What a member reads instead of a link to decide components in Removal templates;
 * null when the row is not components to decide or the viewer can act.
 */
function memberTemplateText(
  fixTarget: BatchHealthFixTarget | null | undefined,
  canManage: boolean,
  linesToDecide: number,
): string | null {
  if (canManage) return null;
  if (fixTarget === "templateLineReview") return linesDecidedByAdmin(linesToDecide);
  return null;
}

/**
 * One item per returned Removal that includes the batch (variant A). Once a
 * sent fact changed it opens the Removal, where it is resubmitted; before that
 * the entries are corrected on this batch's Emissions tab.
 */
function removalCorrectionItem(
  correction: RemovalCorrection,
  facilityId: string,
): CreditBatchOpenItem {
  const code = correction.removalCode;
  if (correction.resubmitNeeded) {
    const names = changedComponentNames(correction);
    return {
      id: `correction:${correction.removalId}`,
      title: `${code}: ${RESUBMIT_NEEDED_LABEL}`,
      detail: names.length
        ? `${joinWithAnd(names)} changed here since ${code} was sent. Resubmit the Removal to send ${names.length === 1 ? "it" : "them"}.`
        : correction.comparison === "unavailable"
          ? `${comparisonUnavailableClause(code)}. Open the Removal to see why.`
          : `Records or files changed since ${code} was sent. Resubmit the Removal to send the changes.`,
      target: { href: recordHref("removal", correction.removalId, { facilityId }) },
    };
  }
  return {
    id: `correction:${correction.removalId}`,
    title: `${code}: ${RETURNED_BY_ISOMETRIC_LABEL}`,
    detail: `${correctionStatementLabel(correction.statement)} ${returnedStatementPhrase(correction.statement.status)}. You can correct this batch's records, and its emissions entries on the Emissions tab.`,
    target: { tab: "emissions" },
  };
}

function hasSameDayEntry(missing: CreditBatchMissingProductionRuns, entryDate: string, runCreatedAt: Date): boolean {
  return missing.manualEntries.some(entry => entry.occurredOn === entryDate && entry.createdAt > runCreatedAt);
}

/** Runs whose emissions have not already been reported by a later manual entry. */
export function uncoveredProductionRuns(missing: CreditBatchMissingProductionRuns) {
  return missing.runs.filter(run => !hasSameDayEntry(missing,
    lateRunEntryDate(run.startDate, missing.batchStartDate), run.createdAt));
}

export interface HeldMissingRun {
  id: string;
  code: string;
  entryDate: string;
  heldByRemovalCode: string | null;
  sameDayEntry: boolean;
}

/** A held batch's fitting runs: addable runs stay; refused runs clear after a later same-day entry. */
export function heldMissingRuns(missing: CreditBatchMissingProductionRuns): HeldMissingRun[] {
  if (!missing.heldRemovalCodes.length || missing.sentRemovalCodes.length) return [];
  return missing.runs.map(run => {
    const entryDate = lateRunEntryDate(run.startDate, missing.batchStartDate);
    return {
      id: run.id, code: run.code, entryDate, heldByRemovalCode: run.heldByRemovalCode,
      sameDayEntry: hasSameDayEntry(missing, entryDate, run.createdAt),
    };
  }).filter(run => run.heldByRemovalCode === null || !run.sameDayEntry);
}

export function missingRunsCountedSentence(count: number): string {
  return count === 1 ? "Its emissions are not counted." : "Their emissions are not counted.";
}

export function missingRunsMemberSentence(count: number): string {
  return count === 1 ? "An admin can add it in Edit." : "An admin can add them in Edit.";
}

export function missingRunsAdminSentence(count: number): string {
  return count === 1 ? "Add it in Edit." : "Add them in Edit.";
}

export function refusedRunsSentence(codes: readonly string[]): string {
  return codes.length === 1
    ? `${codes[0]} cannot be added. Record its diesel and power on the credit batch's Emissions tab.`
    : `${joinWithAnd(codes)} cannot be added. Record their diesel and power on the credit batch's Emissions tab.`;
}

export function sameDayEntrySentence(count: number): string {
  return count === 1
    ? "If an Emissions entry already records its emissions, delete it when you add the run."
    : "If an Emissions entry already records their emissions, delete it when you add the runs.";
}

export function buildCreditBatchOpenItems(input: CreditBatchOpenItemsInput) {
  const canManage = input.canManage;
  const blocking: CreditBatchOpenItem[] = [];
  const check: CreditBatchOpenItem[] = [];

  const late = input.missingProductionRuns;
  if (late?.sentRemovalCodes.length) {
    const codes = joinWithAnd(late.sentRemovalCodes);
    for (const run of uncoveredProductionRuns(late)) {
      const entryDate = lateRunEntryDate(run.startDate, late.batchStartDate);
      const titleAfterCode = ` was recorded after ${codes} ${late.sentRemovalCodes.length === 1 ? "was" : "were"} sent`;
      check.push({
        id: `${LATE_PRODUCTION_RUN_ITEM_PREFIX}${run.id}`,
        productionRun: { id: run.id, code: run.code },
        title: `${run.code}${titleAfterCode}`,
        titleAfterCode,
        detail: `It is not in this credit batch. Record its diesel and power on the Emissions tab, dated ${formatCalendarDate(entryDate)}.`,
        target: { tab: "emissions" },
      });
    }
  } else if (late?.heldRemovalCodes.length) {
    const codes = joinWithAnd(late.heldRemovalCodes);
    for (const run of heldMissingRuns(late)) {
      if (run.heldByRemovalCode !== null) {
        const titleAfterCode = " cannot be added to this credit batch";
        check.push({
          id: `${LATE_PRODUCTION_RUN_ITEM_PREFIX}${run.id}`,
          productionRun: { id: run.id, code: run.code },
          title: `${run.code}${titleAfterCode}`,
          titleAfterCode,
          detail: `Its biochar is in an Application that ${run.heldByRemovalCode} already holds. Record its diesel and power on the Emissions tab, dated ${formatCalendarDate(run.entryDate)}.`,
          target: { tab: "emissions" },
        });
        continue;
      }
      const titleAfterCode = " is not in this credit batch yet";
      const sameDayDetail = run.sameDayEntry
        ? ` If the Emissions entry dated ${formatCalendarDate(run.entryDate)} already records them, delete it when you add the run.`
        : "";
      check.push({
        id: `${MISSING_PRODUCTION_RUN_ITEM_PREFIX}${run.id}`,
        productionRun: { id: run.id, code: run.code },
        title: `${run.code}${titleAfterCode}`,
        titleAfterCode,
        ...(run.sameDayEntry ? { sameDayEntry: true } : {}),
        detail: canManage
          ? `Its emissions are not counted in ${codes}.${sameDayDetail}`
          : `Its emissions are not counted in ${codes}. ${missingRunsMemberSentence(1)}`,
        target: canManage ? { tab: "overview", rowId: CREDIT_BATCH_DETAILS_ROW } : null,
      });
    }
  }

  // An entry that no Removal will report yet.
  for (const line of input.emissionLines ?? []) {
    for (const entry of line.entries) {
      const view = lateEntryView(entry, input.facilityId, { canManage });
      if (view?.destination.kind !== "waiting" || !entry.occurredOn) continue;
      const reason = waitingDetail(view.destination.reason, canManage);
      check.push({
        id: `late-entry:${entry.id ?? `${line.componentId}:${entry.occurredOn}`}`,
        title: waitingEntryTitle(line.displayName, entry.occurredOn),
        detail: view.recordedAfter ? `Recorded after ${view.recordedAfter.removalCode} was sent. ${reason}` : reason,
        target: view.destination.action ? { href: view.destination.action.href } : null,
      });
    }
  }

  for (const healthCheck of input.health?.checks ?? []) {
    if (healthCheck.status !== "unmet") continue;
    const fix = resolveBatchHealthFixTarget(healthCheck);
    let target: CreditBatchOpenItem["target"];
    let detail = healthCheck.detail;
    const memberText = memberTemplateText(fix, canManage, healthCheck.linesToDecide ?? 0);
    if (memberText) {
      target = null;
      detail = memberText;
    } else if (fix === "labSamples") {
      target = { tab: "samples" };
    } else if (fix === "emissions") {
      target = { tab: "emissions" };
    } else if (fix === "batchDetails") {
      target = { tab: "overview", rowId: CREDIT_BATCH_DETAILS_ROW };
    } else {
      target = {
        href: batchHealthFixLinkFor(
          healthCheck,
          input.facilityId,
          input.creditBatchId,
        ).href,
      };
    }
    blocking.push({
      id: `health:${healthCheck.key}:${healthCheck.issueKey ?? fix}`,
      title: certCheckLabel(healthCheck),
      detail,
      ...(healthCheck.whyDetail ? { why: healthCheck.whyDetail } : {}),
      target,
    });
  }

  for (const key of new Set(input.health?.documentWarnings ?? [])) {
    check.push(DOCUMENT_WARNING_ITEMS[key]);
  }

  const outlierCodes = new Set<string>();
  for (const replicate of input.durability?.replicates ?? []) {
    if (!replicate.outlier || outlierCodes.has(replicate.sampleCode)) continue;
    outlierCodes.add(replicate.sampleCode);
    check.push({
      id: `outlier:${replicate.sampleCode}`,
      title: outlierTitle(replicate),
      target: { tab: "samples", rowId: replicate.id },
    });
  }
  for (const code of new Set(input.durability?.eligibility.unpairedHToCSampleCodes ?? [])) {
    const replicate = input.durability?.replicates.find(row => row.sampleCode === code);
    check.push({
      id: `unpaired:${code}`,
      title: `Sample ${code} has H/C without paired O/C`,
      target: { tab: "samples", rowId: replicate?.id },
    });
  }
  for (const line of input.emissionLines ?? []) {
    if (line.state === "needsReview") {
      const fixTarget = line.blocker?.fixTarget;
      const settingsFix = fixTarget === "templateLineReview" || fixTarget === "templateLines" ||
        fixTarget === "certificationTemplates" || fixTarget === "certificationEmissions";
      const memberText = memberTemplateText(fixTarget, canManage, 1);
      const target: CreditBatchOpenItem["target"] = memberText ? null : settingsFix
        ? { href: batchHealthFixLinkFor(
            { key: "emissions", fixTarget },
            input.facilityId,
            input.creditBatchId,
          ).href }
        : { tab: "emissions", rowId: line.componentId };
      check.push({
        id: `emission:${line.componentId}`,
        title: `${line.displayName}: ${EMISSION_LINE_STATE_LABELS.needsReview}`,
        detail: memberText ?? line.blocker?.message,
        target,
      });
    }
  }

  for (const correction of input.health?.removalCorrections ?? []) {
    check.push(removalCorrectionItem(correction, input.facilityId));
  }
  return { blocking, check };
}

/** Items the batch is waiting on. They need the page model and never count as to-dos. */
export function buildCreditBatchWaitingItems(pageModel: CreditBatchPageModel | undefined): CreditBatchOpenItem[] {
  const waiting: CreditBatchOpenItem[] = [];
  const statement = pageModel?.milestones.ghgStatement;
  if (statement?.status.kind === "in-verification") {
    waiting.push({
      id: `verification:${statement.id}`,
      title: `GHG Statement ${ghgStatementPeriodLabel(statement)}: In verification`,
      target: { tab: "removals" },
    });
  }
  const notAppliedDryKg = pageModel?.mass.notAppliedDryKg;
  if (notAppliedDryKg != null && notAppliedDryKg >= MIN_VISIBLE_NOT_APPLIED_DRY_KG) {
    waiting.push({
      id: "not-applied",
      title: `${formatTonnes(kgToTonnes(notAppliedDryKg))} produced but not applied yet`,
      detail: "It can join a Removal once its application is recorded.",
      target: { tab: "removals" },
    });
  }
  return waiting;
}
