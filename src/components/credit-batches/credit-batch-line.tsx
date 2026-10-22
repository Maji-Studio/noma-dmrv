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
import { CertificateIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { formatDateRange } from "@/lib/format-utils";
import { FormFooterPreview } from "@/components/forms/form-footer-preview";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { CREDIT_BATCH_INFO_LABEL, type CreditBatchLineBatch, type CreditBatchLineCopy } from "./credit-batch-line-copy";

export interface CreditBatchLineProps {
  copy: CreditBatchLineCopy;
  /** Opens the batch page in the right facility; optional. */
  facilityId?: string | null;
  /** Re-runs a failed check; shown when `copy.retry` is set. */
  onRetry?: () => void;
  /** A retry is running. */
  retrying?: boolean;
}

/** A batch code as a link; a new tab, so the unsaved form stays open. */
function BatchLink({ batch, facilityId }: { batch: CreditBatchLineBatch; facilityId?: string | null }) {
  return (
    <Link
      href={creditBatchDeepLinkHref(batch.id, facilityId ?? undefined)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[var(--clr-dark-purple)] underline underline-offset-2"
    >
      {batch.code}
      <span className="sr-only"> (opens in a new tab)</span>
    </Link>
  );
}

/** "+N": lists every batch and date window. The hit area is 44px tall and at least 24px wide, extending right from the button's left edge to avoid the preceding batch link. */
function MoreBatches({ batches, rest, facilityId }: { batches: CreditBatchLineBatch[]; rest: number; facilityId?: string | null }) {
  return (
    <>
      {" "}
      <Popover
        title="Credit batches"
        align="start"
        trigger={
          <button
            type="button"
            aria-label={`Show all ${batches.length} credit batches`}
            className="relative cursor-pointer text-[var(--clr-dark-purple)] after:absolute after:left-0 after:top-1/2 after:h-44 after:w-full after:min-w-24 after:-translate-y-1/2 after:content-[''] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-interaction)]"
          >
            +{rest}
          </button>
        }
      >
        <ul className="flex flex-col gap-8">
          {batches.map((batch) => (
            <li key={batch.id} className="flex flex-col">
              <BatchLink batch={batch} facilityId={facilityId} />
              {batch.startDate && batch.endDate && (
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  {formatDateRange(batch.startDate, batch.endDate)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}

export function CreditBatchLine({ copy, facilityId, onRetry, retrying = false }: CreditBatchLineProps) {
  const [first] = copy.batches;
  const rest = copy.batches.length - 1;
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
      {first && <BatchLink batch={first} facilityId={facilityId} />}
      {rest > 0 && copy.batchJoin === "or" && copy.batches.length === 2 ? (
        <>
          {" or "}
          <BatchLink batch={copy.batches[1]} facilityId={facilityId} />
        </>
      ) : (
        rest > 0 && <MoreBatches batches={copy.batches} rest={rest} facilityId={facilityId} />
      )}
      {/* The window is the long part: below 640px the line keeps one row. */}
      {copy.window && <span className="hidden sm:inline">{copy.window}</span>}
      {copy.tail}
    </FormFooterPreview>
  );
}
