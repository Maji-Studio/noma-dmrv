/**
 * SourceRecords: the production runs and applications behind this Removal, as
 * links, behind a closed disclosure. The credit batches are not listed here:
 * the component table's header names them once.
 */
"use client";

import Link from "next/link";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { Accordion } from "@/components/ui/accordion";
import type { RemovalLedgerPreview } from "@/fn/certification/removal-ledger-preview";
import {
  productionRunDeepLinkHref,
  traceabilityApplicationHref,
} from "@/lib/certification/links";
import { countLabel } from "./submission-facts";

const LINK_ICON_SIZE = 12;

const ACCORDION_ITEM =
  "rounded-none border-[var(--color-border-secondary)] bg-[var(--color-background-white)]";
const ACCORDION_TRIGGER =
  "min-h-44 bg-[var(--color-background-white)] px-16 py-10 hover:bg-[var(--color-surface-light)]";

function RecordLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-44 items-center gap-4 font-mono underline-offset-4 hover:text-[var(--color-interaction)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] md:min-h-0"
    >
      {children}
      <ArrowSquareOutIcon size={LINK_ICON_SIZE} aria-hidden />
    </Link>
  );
}

interface SourceRecordsProps {
  ledger: Pick<RemovalLedgerPreview, "productionRuns" | "applications" | "creditBatches">;
  facilityId: string;
}

export function SourceRecords({ ledger, facilityId }: SourceRecordsProps) {
  const { productionRuns, applications } = ledger;
  if (productionRuns.length === 0 && applications.length === 0) return null;
  const creditBatchCodeById = new Map(ledger.creditBatches.map((batch) => [batch.id, batch.code]));
  return (
    <Accordion.Root className="gap-0" defaultValue={[]}>
      <Accordion.Item value="source-records" className={ACCORDION_ITEM}>
        <Accordion.Header>
          <Accordion.Trigger
            className={ACCORDION_TRIGGER}
            labelClassName="body-small normal-case tracking-normal text-[var(--color-text-primary)]"
          >
            <span className="flex w-full items-center justify-between gap-12">
              <span>Source records</span>
              <span className="hidden body-caption font-normal normal-case tracking-normal text-[var(--color-text-tertiary)] sm:inline">
                {countLabel(productionRuns.length, "production run")}, {countLabel(applications.length, "application")}
              </span>
            </span>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel className="[&>div]:p-0">
          <ul className="flex flex-col gap-6 border-t border-[var(--color-border-tertiary)] px-16 py-12 body-small text-[var(--color-text-secondary)]">
            {productionRuns.map((run) => (
              <li key={run.id} className="flex items-baseline justify-between gap-12">
                <span>Production run</span>
                <RecordLink href={productionRunDeepLinkHref(run.id, facilityId)}>
                  {run.code ?? "Open run"}
                </RecordLink>
              </li>
            ))}
            {applications.map((application) => (
              <li key={application.id} className="flex items-baseline justify-between gap-12">
                <span>{application.deliveryCode} · application</span>
                <span className="flex flex-wrap justify-end gap-x-8 gap-y-4">
                  {application.creditBatchIds.length === 0
                    ? "No credit batch"
                    : application.creditBatchIds.map((creditBatchId) => (
                        <RecordLink
                          key={creditBatchId}
                          href={traceabilityApplicationHref(creditBatchId, application.id)}
                        >
                          {application.code}
                          {application.creditBatchIds.length > 1
                            ? ` · ${creditBatchCodeById.get(creditBatchId) ?? creditBatchId}`
                            : ""}
                        </RecordLink>
                      ))}
                </span>
              </li>
            ))}
          </ul>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}
