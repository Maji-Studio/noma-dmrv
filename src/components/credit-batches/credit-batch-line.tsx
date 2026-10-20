/**
 * CreditBatchLine
 * The one-line credit batch statement in a form's sticky footer (#1059
 * section 2), rendered from a `CreditBatchLineCopy`. Each form decides its own
 * copy; this renders it the same way everywhere: batch codes as links that
 * open the batch in a new tab (the unsaved form stays), the ⓘ explanation,
 * and Retry when a check failed.
 */
"use client";

import Link from "next/link";
import { Fragment } from "react";
import { CertificateIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { FormFooterPreview } from "@/components/forms/form-footer-preview";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { CREDIT_BATCH_INFO_LABEL, type CreditBatchLineCopy } from "./credit-batch-line-copy";

export interface CreditBatchLineProps {
  copy: CreditBatchLineCopy;
  /** Opens the batch page in the right facility; optional. */
  facilityId?: string | null;
  /** Re-runs a failed check; shown when `copy.retry` is set. */
  onRetry?: () => void;
  /** A retry is running. */
  retrying?: boolean;
}

export function CreditBatchLine({ copy, facilityId, onRetry, retrying = false }: CreditBatchLineProps) {
  return (
    <FormFooterPreview
      icon={CertificateIcon}
      tone={copy.tone}
      busy={copy.busy}
      info={copy.info ? { label: copy.infoLabel ?? CREDIT_BATCH_INFO_LABEL, content: copy.info } : null}
      action={copy.retry && onRetry ? (
        <Button type="button" variant="default" size="small" busy={retrying} onClick={onRetry}>
          Retry
        </Button>
      ) : undefined}
    >
      {copy.lead}
      {copy.batches.map((batch, index) => (
        <Fragment key={batch.id}>
          {index > 0 && ", "}
          {/* A new tab, so the unsaved form stays open. */}
          <Link
            href={creditBatchDeepLinkHref(batch.id, facilityId ?? undefined)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[var(--clr-dark-purple)] underline underline-offset-2"
          >
            {batch.code}
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </Fragment>
      ))}
      {copy.tail}
    </FormFooterPreview>
  );
}
