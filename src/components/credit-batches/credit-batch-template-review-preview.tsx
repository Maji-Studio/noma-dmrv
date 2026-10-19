/**
 * The line review status of the Removal template chosen in the switch dialog,
 * read live from Isometric before the switch: how many lines need review, or
 * that every line is reviewed. Lines that need review, and a template Isometric
 * did not return in full, block the batch's Removals until an Owner or Admin
 * settles them in the Removal templates review. The preview never blocks the
 * switch itself, so a failed read offers a retry and nothing more.
 */
"use client";

import Link from "next/link";
import { TEMPLATE_NOT_FULLY_READ_TITLE } from "@/components/certification/removal-template-review-model";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useRemovalTemplateReviewPreview } from "@/hooks/use-removal-template-review";
import { certificationRemovalTemplatesHref } from "@/lib/certification/links";

export interface TemplateReviewPreviewProps {
  facilityId: string;
  /** The template chosen in the dialog; nothing shows while none is chosen. */
  removalTemplateId: string;
  creditBatchCode: string;
}

const NOT_FULLY_READ_COPY = "Isometric did not return every unit or factor.";

function needsReviewTitle(count: number): string {
  return `${count} ${count === 1 ? "line needs" : "lines need"} review`;
}

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
    return <Notice tone="info">All lines in this template are reviewed.</Notice>;
  }

  const blocked = needsReviewCount > 0
    ? `Removals for ${creditBatchCode} stay blocked until an Owner or Admin reviews ${needsReviewCount === 1 ? "it" : "them"}.`
    : `Removals for ${creditBatchCode} stay blocked until the template is read in full.`;
  return (
    <Notice
      tone="warning"
      title={needsReviewCount > 0 ? needsReviewTitle(needsReviewCount) : TEMPLATE_NOT_FULLY_READ_TITLE}
      action={
        // A new tab, so this dialog and its unsaved choice stay open.
        <Link
          href={certificationRemovalTemplatesHref(facilityId, removalTemplateId)}
          target="_blank"
          rel="noreferrer"
          className="body-small underline underline-offset-2"
        >
          Review lines in a new tab
        </Link>
      }
    >
      {notFullyRead ? `${NOT_FULLY_READ_COPY} ${blocked}` : blocked}
    </Notice>
  );
}
