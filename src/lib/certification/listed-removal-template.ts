import { SafeError } from "@/lib/errors";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { REMOVAL_TEMPLATE_BLOCKERS } from "./removal-template-blockers";

export function findListedRemovalTemplate(templates: readonly IsometricGhgEntryTemplate[], templateId: string): IsometricGhgEntryTemplate {
  const template = templates.find((candidate) => candidate.id === templateId);
  if (!template) throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateNotFound);
  if (template.credit_type !== "REMOVAL") throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.notRemovalTemplate);
  return template;
}
