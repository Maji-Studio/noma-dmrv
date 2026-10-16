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
import { formatTonnes } from "@/lib/format-utils";
import { ghgStatementPeriodLabel } from "./ghg-statement-period-label";

export interface CreditBatchOpenItem {
  id: string;
  title: string;
  detail?: string;
  target:
    | { tab: "overview" | "production" | "samples" | "emissions" | "removals"; rowId?: string }
    | { href: string };
}

export interface CreditBatchOpenItemsInput {
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
    } else if ([
      "certificationTemplates",
      "creditBatchTemplate",
      "templateLineReview",
      "batchDetails",
    ].includes(fix)) {
      target = { tab: "overview" };
    } else {
      target = {
        href: batchHealthFixLinkFor(
          healthCheck,
          input.pageModel?.facilityId ?? "",
          input.pageModel?.creditBatchId,
        ).href,
      };
    }
    blocking.push({
      id: `health:${healthCheck.key}:${healthCheck.issueKey ?? fix}`,
      // OPEN(#1136): use shared problem wording once the owner decides it.
      title: healthCheck.requirementLabel,
      detail: healthCheck.detail,
      target,
    });
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
      check.push({
        id: `emission:${line.componentId}`,
        title: `${line.displayName} needs review`,
        detail: line.blocker?.message,
        target: { tab: "emissions", rowId: line.componentId },
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
  if (notAppliedDryKg != null && notAppliedDryKg > 0) {
    waiting.push({
      id: "not-applied",
      title: `${formatTonnes(kgToTonnes(notAppliedDryKg))} produced but not applied yet`,
      detail: "It can join a Removal once its application is recorded.",
      target: { tab: "removals" },
    });
  }
  return { blocking, check, waiting };
}
