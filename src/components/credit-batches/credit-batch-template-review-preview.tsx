/**
 * The line review status of the Removal template chosen in the switch dialog,
 * read live from Isometric before the switch: how many lines are still to
 * decide, or that every line is decided. Lines to decide, and a template
 * Isometric did not return in full, block the batch's Removals until an Owner
 * or Admin settles them in Removal templates. The preview never blocks the
 * switch itself, so a failed read offers a retry and nothing more.
 */
"use client";

import Link from "next/link";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { linesToDecideLabel, TEMPLATE_NOT_FULLY_READ_TITLE } from "@/components/certification/removal-template-review-model";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useRemovalTemplateReviewPreview } from "@/hooks/use-removal-template-review";
import { certificationRemovalTemplatesHref, DECIDE_LINES_LINK_LABEL, OPEN_REMOVAL_TEMPLATES_LINK_LABEL } from "@/lib/certification/links";

export interface TemplateReviewPreviewProps {
  facilityId: string;
  /** The template chosen in the dialog; nothing shows while none is chosen. */
  removalTemplateId: string;
  creditBatchCode: string;
}

const NOT_FULLY_READ_COPY = "Isometric did not return every unit or factor.";

export function TemplateReviewPreview({ facilityId, removalTemplateId, creditBatchCode }: TemplateReviewPreviewProps) {
  const preview = useRemovalTemplateReviewPreview(facilityId, removalTemplateId, !!removalTemplateId);
  if (!removalTemplateId) return null;

  if (preview.isPending) {
    return (
      <Notice tone="info" aria-busy="true">
        Checking this template&apos;s lines…
      </Notice>
    );
  }

  if (preview.isError) {
    return (
      <Notice
        tone="warning"
        action={
          <Button size="small" variant="weak" busy={preview.isFetching} onClick={() => void preview.refetch()}>
            Try again
          </Button>
        }
      >
        This template&apos;s lines could not be checked. You can still switch.
      </Notice>
    );
  }

  const { needsReviewCount, enrichmentProblems } = preview.data;
  const notFullyRead = enrichmentProblems.length > 0;
  if (needsReviewCount === 0 && !notFullyRead) {
    return <Notice tone="info">All lines in this template are decided.</Notice>;
  }

  const blocked = needsReviewCount > 0
    ? `Removals for ${creditBatchCode} stay blocked until an Owner or Admin decides ${needsReviewCount === 1 ? "it" : "them"}.`
    : `Removals for ${creditBatchCode} stay blocked until the template is read in full.`;
  return (
    <Notice
      tone="warning"
      title={needsReviewCount > 0 ? linesToDecideLabel(needsReviewCount) : TEMPLATE_NOT_FULLY_READ_TITLE}
      action={
        // A new tab, so this dialog and its unsaved choice stay open.
        <Link
          href={certificationRemovalTemplatesHref(facilityId, removalTemplateId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-4 body-small underline underline-offset-2"
        >
          {/* "Decide lines" only when there are lines to decide; a read problem has none. */}
          {needsReviewCount > 0 ? DECIDE_LINES_LINK_LABEL : OPEN_REMOVAL_TEMPLATES_LINK_LABEL}
          <ArrowSquareOutIcon size={12} aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </Link>
      }
    >
      {notFullyRead ? `${NOT_FULLY_READ_COPY} ${blocked}` : blocked}
    </Notice>
  );
}
