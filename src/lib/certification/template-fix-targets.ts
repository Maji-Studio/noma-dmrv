import type { UnbindableTemplateInput } from "@/lib/isometric/template-binding-coverage";
import type { BatchHealthFixTarget } from "./batch-health";
import {
  isTemplateRoutedCode,
  removalTemplateBlockerDestination,
  type RemovalTemplateBlockerDestination,
  type TemplateRoutedBlockerCode,
} from "./removal-template-blockers";

export type TemplateFixTarget = RemovalTemplateBlockerDestination;
const TEMPLATE_FIX_TARGETS: ReadonlySet<string> = new Set<TemplateFixTarget>([
  "templateSetup", "templateLineReview", "templateLines", "templateReplacement",
]);

/** Delegates to the one routing table in `removal-template-blockers.ts`. */
export function templateFixTarget(code: TemplateRoutedBlockerCode): TemplateFixTarget {
  return removalTemplateBlockerDestination(code);
}

/** Whether a fix target is one of the template destinations above. */
export function isTemplateFixTarget(target: string | null | undefined): target is TemplateFixTarget {
  return !!target && TEMPLATE_FIX_TARGETS.has(target);
}

/**
 * The table decides for every routed code. The one target set as data is
 * `templateReplacement`: the line binding knows only another template can fill
 * that line. A code the table does not route keeps its own template target,
 * else opens Removal templates.
 */
export function templateLineFixTarget(blocker: { code: string; fixTarget?: BatchHealthFixTarget | null }): TemplateFixTarget {
  if (blocker.fixTarget === "templateReplacement") return "templateReplacement";
  if (isTemplateRoutedCode(blocker.code)) return templateFixTarget(blocker.code);
  return isTemplateFixTarget(blocker.fixTarget) ? blocker.fixTarget : "templateLines";
}

export function templateCoverageFixTarget(input: UnbindableTemplateInput): TemplateFixTarget {
  switch (input.reason) {
    case "unassigned":
    case "ambiguous":
      return "templateLineReview";
    case "unmapped":
      return "templateReplacement";
    case "project-scope":
    case "unrecognized-component":
      return "templateLines";
  }
}
