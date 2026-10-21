import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
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
import { formatTonnes } from "@/lib/format-utils";
import {
  RESUBMIT_NEEDED_LABEL,
  changedComponentNames,
  correctionStatementLabel,
  joinWithAnd,
  removalSheetHref,
  returnedStatementPhrase,
} from "@/lib/removal-correction-copy";
import { ghgStatementPeriodLabel } from "./ghg-statement-period-label";

// Five kg rounds up to the smallest visible amount at two-decimal tonne precision.
export const MIN_VISIBLE_NOT_APPLIED_DRY_KG = 5;

/** Overview rows a health check lands on: the Removal template block and the batch details. */
export const CREDIT_BATCH_TEMPLATE_ROW = ENTITY_FOCUS_TARGETS.removalTemplate;
export const CREDIT_BATCH_DETAILS_ROW = "batch-details";

export interface CreditBatchOpenItem {
  id: string;
  title: string;
  detail?: string;
  /** The protocol reasoning behind a requirement, shown behind an ⓘ. */
  why?: string;
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
  pageModel?: CreditBatchPageModel;
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
        : `Entries changed on another credit batch since ${code} was sent. Resubmit the Removal to send them.`,
      target: { href: removalSheetHref(correction.removalId, facilityId) },
    };
  }
  return {
    id: `correction:${correction.removalId}`,
    title: `${code}: ${RETURNED_BY_ISOMETRIC_LABEL}`,
    detail: `${correctionStatementLabel(correction.statement)} ${returnedStatementPhrase(correction.statement.status)}. You can correct the sent entries on the Emissions tab.`,
    target: { tab: "emissions" },
  };
}

export function buildCreditBatchOpenItems(input: CreditBatchOpenItemsInput) {
  const canManage = input.canManage;
  const blocking: CreditBatchOpenItem[] = [];
  const check: CreditBatchOpenItem[] = [];
  const waiting: CreditBatchOpenItem[] = [];

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
    } else if (fix === "creditBatchTemplate") {
      target = { tab: "overview", rowId: CREDIT_BATCH_TEMPLATE_ROW };
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

  const statement = input.pageModel?.milestones.ghgStatement;
  if (statement?.status.kind === "in-verification") {
    waiting.push({
      id: `verification:${statement.id}`,
      title: `GHG Statement ${ghgStatementPeriodLabel(statement)}: In verification`,
      target: { tab: "removals" },
    });
  }
  const notAppliedDryKg = input.pageModel?.mass.notAppliedDryKg;
  if (notAppliedDryKg != null && notAppliedDryKg >= MIN_VISIBLE_NOT_APPLIED_DRY_KG) {
    waiting.push({
      id: "not-applied",
      title: `${formatTonnes(kgToTonnes(notAppliedDryKg))} produced but not applied yet`,
      detail: "It can join a Removal once its application is recorded.",
      target: { tab: "removals" },
    });
  }
  return { blocking, check, waiting };
}
