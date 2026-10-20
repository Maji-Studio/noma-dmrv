/**
 * ComponentsSent — the read-only "Components sent" section of the submit step:
 * every Removal template component per credit batch with the value Isometric
 * receives, where it comes from, and its files. Changes happen on the Empty
 * components step or the batch's Emissions page, never here.
 */
"use client";

import { Fragment } from "react";
import Link from "next/link";
import { ArrowSquareOutIcon, PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { SectionLabel } from "@/components/forms/section-label";
import { InfoHint } from "@/components/ui/tooltip";
import { ENTRY_ENTITY_TYPE } from "@/components/emissions/emission-entry-files";
import { useDocumentsForEntity } from "@/hooks/use-documents";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { MISSING_VALUE, pluralize } from "@/lib/copy-utils";
import { formatDateRange } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  groupSentRows,
  sentComponentRows,
  type SentComponentRow,
} from "./components-sent-model";

const ICON_SIZE = 14;
const LINK_ICON_SIZE = 12;
const SECTION_HINT =
  "What Isometric receives for each component of the Removal template, per credit batch.";

const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-4 md:items-center";
// The Files column exists only in a batch where some component has files.
const ROW_GRID_WITH_FILES =
  "md:grid-cols-[minmax(0,1fr)_minmax(0,272px)_120px_104px]";
const ROW_GRID_NO_FILES = "md:grid-cols-[minmax(0,1fr)_minmax(0,272px)_104px]";

function EntryFileNames({ entryId }: { entryId: string }) {
  const { data } = useDocumentsForEntity(ENTRY_ENTITY_TYPE, entryId);
  return (
    <>
      {(data ?? [])
        .filter((document) => document.uploadStatus === "uploaded")
        .map((document) => (
          <span key={document.id} className="block">
            {document.fileName}
          </span>
        ))}
    </>
  );
}

function FilesCell({ row }: { row: SentComponentRow }) {
  if (row.fileCount === 0) {
    return (
      <span className="text-[var(--color-text-tertiary)]">
        {MISSING_VALUE.none}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-4 text-[var(--color-text-secondary)]">
      <PaperclipIcon size={ICON_SIZE} aria-hidden />
      {row.fileCount} {pluralize(row.fileCount, "file", "files")}
      <InfoHint label={`File names for ${row.name}`}>
        {row.fileEntryIds.map((id) => (
          <EntryFileNames key={id} entryId={id} />
        ))}
      </InfoHint>
    </span>
  );
}

function SentRow({ row, withFiles }: { row: SentComponentRow; withFiles: boolean }) {
  return (
    <li
      className={cn(
        ROW_GRID,
        withFiles ? ROW_GRID_WITH_FILES : ROW_GRID_NO_FILES,
        "px-16 py-10 [border-top:var(--row-divider)]",
      )}
    >
      <span className="col-span-2 body-small text-[var(--color-text-primary)] md:col-span-1">
        {row.name}
      </span>
      <span className="col-start-1 row-start-2 flex flex-wrap items-center gap-x-8 body-small text-[var(--color-text-secondary)] md:col-auto md:row-auto">
        <span>{row.source}</span>
        <span className="body-small md:hidden">
          {row.fileCount > 0 && <FilesCell row={row} />}
        </span>
      </span>
      {withFiles && (
        <span className="hidden body-small md:block">
          {row.fileCount > 0 && <FilesCell row={row} />}
        </span>
      )}
      <span
        className={cn(
          "col-start-2 row-start-2 text-right body-small font-mono tabular-nums md:col-auto md:row-auto",
          row.valueMissing
            ? "text-[var(--color-text-tertiary)]"
            : "text-[var(--color-text-primary)]",
        )}
      >
        {row.value}
        {row.notSentReason && (
          <InfoHint label={`Why ${row.name} is not sent`} className="ml-4">
            {row.notSentReason}
          </InfoHint>
        )}
      </span>
    </li>
  );
}

interface ComponentsSentProps {
  ctx: Pick<
    RemovalCertifyContext,
    "memberBatches" | "emissionLinesByBatchId" | "unbindableTemplateInputs"
  >;
  facilityId: string;
  /** Components whose datapoints are fixed in the template (from the compiled review). */
  fixedComponentIds?: ReadonlySet<string>;
}

export function ComponentsSent({ ctx, facilityId, fixedComponentIds }: ComponentsSentProps) {
  const unbindableComponentIds = new Set(
    (ctx.unbindableTemplateInputs ?? []).map((input) => input.componentId),
  );
  const byBatch = ctx.emissionLinesByBatchId ?? {};
  const batches = ctx.memberBatches.filter(
    (batch) => (byBatch[batch.id] ?? []).length > 0,
  );
  if (batches.length === 0) return null;
  return (
    <section className="flex flex-col gap-12" aria-label="Components sent">
      <SectionLabel hint={SECTION_HINT}>Components sent</SectionLabel>
      {batches.map((batch) => {
        const rows = sentComponentRows(byBatch[batch.id], {
          fixedComponentIds,
          unbindableComponentIds,
        });
        const withFiles = rows.some((row) => row.fileCount > 0);
        return (
          <div
            key={batch.id}
            className="flex flex-col bg-[var(--paper)] [border:var(--panel-border)]"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-12 gap-y-4 bg-[var(--sea)] px-16 py-10">
              <span className="inline-flex flex-wrap items-baseline gap-x-8 body-small font-medium">
                <Link
                  href={creditBatchDeepLinkHref(batch.id, facilityId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-4 font-mono text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline"
                >
                  {batch.code}
                  <ArrowSquareOutIcon size={LINK_ICON_SIZE} aria-hidden />
                </Link>
                <span className="font-normal text-[var(--color-text-secondary)]">
                  {formatDateRange(batch.startDate, batch.endDate)}
                </span>
              </span>
              <span className="body-caption text-[var(--color-text-secondary)]">
                {rows.length} {pluralize(rows.length, "component", "components")}
              </span>
            </div>
            <ul aria-label={`Components sent for ${batch.code}`}>
              {groupSentRows(rows).map((group) => (
                <Fragment key={group.key}>
                  <li className="px-16 pt-12 pb-2 body-caption font-medium text-[var(--color-text-tertiary)] [border-top:var(--row-divider)]">
                    {group.label}
                  </li>
                  {group.rows.map((row) => (
                    <SentRow key={row.componentId} row={row} withFiles={withFiles} />
                  ))}
                </Fragment>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
