/**
 * TemplateSetupNotice: shown instead of the emission lines when the credit
 * batch has no usable Removal template. It says what is missing and links to
 * where it is fixed, with no Retry because reloading cannot change it.
 */
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { buttonVariants } from "@/components/ui/button";
import { batchHealthFixLinkFor } from "@/lib/certification/batch-health-links";
import {
  removalTemplateBlockerDestination,
  type RemovalTemplateBlocker,
  type RemovalTemplateBlockerCode,
} from "@/lib/certification/removal-template-blockers";

const SET_TEMPLATE_LABEL = "Set template";
/** What a read-only batch says for blockers whose whole message is a repair step. */
const READ_ONLY_FACTS: Partial<Record<RemovalTemplateBlockerCode, string>> = {
  unpinnedTemplate: "This credit batch has no Removal template.",
  missingFixedDatapoint: "Some fixed values are not set in the Isometric template.",
};

/** The notice text: the full message, or on a read-only batch only the fact. */
export function templateSetupNoticeText(blocker: RemovalTemplateBlocker, readOnly: boolean): string {
  if (!readOnly) return blocker.message;
  return blocker.copy?.detail ?? READ_ONLY_FACTS[blocker.code] ?? blocker.message;
}

export function TemplateSetupNotice({
  blocker,
  facilityId,
  creditBatchId,
  readOnly = false,
}: {
  blocker: RemovalTemplateBlocker;
  facilityId: string;
  creditBatchId: string;
  /** A read-only batch states the problem without its repair step or Settings link. */
  readOnly?: boolean;
}) {
  const fixTarget = removalTemplateBlockerDestination(blocker.code);
  const link = batchHealthFixLinkFor(
    { key: fixTarget === "templateSetup" ? "templateSet" : "templateLines", fixTarget },
    facilityId,
    creditBatchId,
  );
  // The Overview tab calls the unpinned state "Set template"; the link helper says "Switch".
  const label = blocker.code === "unpinnedTemplate" ? SET_TEMPLATE_LABEL : link.label;
  return (
    <Notice
      tone="warning"
      action={readOnly ? undefined : <Link href={link.href} className={buttonVariants({ variant: "weak", size: "small" })}>{label}</Link>}
    >
      {templateSetupNoticeText(blocker, readOnly)}
    </Notice>
  );
}
