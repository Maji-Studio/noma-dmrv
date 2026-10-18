import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  O_TO_C_ORG_ELIGIBILITY_MAX,
  isUsableNumber,
} from "@/lib/calculations/biochar-eligibility";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import type { BatchHealth } from "@/lib/certification/batch-health";
import {
  batchHealthFixLinkFor,
  resolveBatchHealthFixTarget,
} from "@/lib/certification/batch-health-links";
import type {
  DurabilityBatchSummary,
  DurabilitySummaryReplicate,
} from "@/lib/certification/durability-batch-summary";
import type { BatchEmissionLine } from "@/lib/certification/emission-lines";
import {
  NO_LAB_REPORT_PHRASE,
  NO_REFLECTANCE_HISTOGRAM_PHRASE,
} from "@/lib/certification/sample-document-warnings";
import { ENTITY_FOCUS_TARGETS } from "@/lib/entity-deep-link";
import { formatTonnes } from "@/lib/format-utils";
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
  target:
    | { tab: "overview" | "production" | "samples" | "emissions" | "removals"; rowId?: string }
    | { href: string };
}

export interface CreditBatchOpenItemsInput {
  facilityId: string;
  creditBatchId: string;
  health?: BatchHealth;
  durability?: DurabilityBatchSummary;
  emissionLines?: readonly BatchEmissionLine[];
  pageModel?: CreditBatchPageModel;
}

function outlierTitle(replicate: DurabilitySummaryReplicate): string {
  const limits: string[] = [];
  if (isUsableNumber(replicate.hToCorg) && replicate.hToCorg >= H_TO_C_ORG_ELIGIBILITY_MAX) {
    const comparison = replicate.hToCorg === H_TO_C_ORG_ELIGIBILITY_MAX ? "at" : "above";
    limits.push(`H/Corg ${comparison} the ${H_TO_C_ORG_ELIGIBILITY_MAX} limit`);
  }
  if (isUsableNumber(replicate.oToCorg) && replicate.oToCorg >= O_TO_C_ORG_ELIGIBILITY_MAX) {
    const comparison = replicate.oToCorg === O_TO_C_ORG_ELIGIBILITY_MAX ? "at" : "above";
    limits.push(`O/Corg ${comparison} the ${O_TO_C_ORG_ELIGIBILITY_MAX} limit`);
  }
  return limits.length
    ? `Sample ${replicate.sampleCode}: ${limits.join(" and ")}`
    : `Sample ${replicate.sampleCode} is outside the durability limits`;
}

/**
 * A batch health warning (non-blocking Sample document evidence) as a Check
 * item. Known warnings get a fixed id and a problem title; any other warning
 * keeps its own text as the title.
 */
function documentWarningItem(warning: string): CreditBatchOpenItem {
  const target = { tab: "samples" as const };
  if (warning.includes(NO_LAB_REPORT_PHRASE)) {
    return { id: "document:lab-report", title: "No lab report on any Sample", detail: "Upload a lab report to one of its Samples. You can still submit the Removal.", target };
  }
  if (warning.includes(NO_REFLECTANCE_HISTOGRAM_PHRASE)) {
    return { id: "document:reflectance-histogram", title: "No reflectance histogram on any Sample", detail: "Upload a reflectance histogram to one of its Samples. You can still submit the Removal.", target };
  }
  return { id: `document:${warning}`, title: warning, target };
}

export function buildCreditBatchOpenItems(input: CreditBatchOpenItemsInput) {
  const blocking: CreditBatchOpenItem[] = [];
  const check: CreditBatchOpenItem[] = [];
  const waiting: CreditBatchOpenItem[] = [];

  for (const healthCheck of input.health?.checks ?? []) {
    if (healthCheck.status !== "unmet") continue;
    const fix = resolveBatchHealthFixTarget(healthCheck);
    let target: CreditBatchOpenItem["target"];
    if (fix === "labSamples") {
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
      title: healthCheck.requirementLabel,
      detail: healthCheck.detail,
      ...(healthCheck.whyDetail ? { why: healthCheck.whyDetail } : {}),
      target,
    });
  }

  for (const warning of new Set(input.health?.warnings ?? [])) {
    check.push(documentWarningItem(warning));
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
      const settingsFix = fixTarget === "templateLineReview" ||
        fixTarget === "certificationTemplates" || fixTarget === "certificationEmissions";
      const target: CreditBatchOpenItem["target"] = settingsFix
        ? { href: batchHealthFixLinkFor(
            { key: "emissions", fixTarget },
            input.facilityId,
            input.creditBatchId,
          ).href }
        : { tab: "emissions", rowId: line.componentId };
      check.push({
        id: `emission:${line.componentId}`,
        title: `${line.displayName} needs review`,
        detail: line.blocker?.message,
        target,
      });
    }
  }

  const statement = input.pageModel?.milestones.ghgStatement;
  if (statement?.status === "in-verification") {
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
