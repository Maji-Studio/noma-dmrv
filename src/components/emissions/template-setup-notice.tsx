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
} from "@/lib/certification/removal-template-blockers";

const SET_TEMPLATE_LABEL = "Set template";

export function TemplateSetupNotice({
  blocker,
  facilityId,
  creditBatchId,
  readOnly = false,
}: {
  blocker: RemovalTemplateBlocker;
  facilityId: string;
  creditBatchId: string;
  /** A read-only batch states the problem and offers no Settings link. */
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
      {blocker.message}
    </Notice>
  );
}
