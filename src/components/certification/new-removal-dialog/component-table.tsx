/**
 * ComponentTable: the one read-only table of the submit step. Every Removal
 * template component with the figure Isometric receives, where it comes from,
 * its files and its state. The credit batches are named once, in the header,
 * each with its production emissions claim. Changes happen on the Empty
 * components step or the batch's Emissions page, never here.
 *
 * Only a Blocked row asks for something. Its row stays white; the one tinted
 * thing on the step is the error Notice above, which links to each blocked row.
 */
"use client";

import { Fragment } from "react";
import Link from "next/link";
import {
  ArrowSquareOutIcon,
  PaperclipIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { InfoHint } from "@/components/ui/tooltip";
import { ENTRY_ENTITY_TYPE } from "@/components/emissions/emission-entry-files";
import { useDocumentsForEntity } from "@/hooks/use-documents";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { certificationRemovalsHref } from "@/lib/certification/links";
import { pluralize } from "@/lib/copy-utils";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import type { ComponentRow, ComponentTable as ComponentTableModel } from "./component-table-model";

const ICON_SIZE = 14;
const LINK_ICON_SIZE = 12;
const TONNE_DIGITS = 1;

export const STATE_WORD = {
  included: "Included",
  blocked: "Blocked",
  earlier: "Sent earlier",
} as const;

/** The row's id, so the blocker Notice can scroll to it and move focus there. */
export function componentRowDomId(componentId: string): string {
  return `submit-component-${componentId}`;
}

/** Scroll the table to a component's row and move focus to it. */
export function jumpToComponentRow(componentId: string): void {
  const row = document.getElementById(componentRowDomId(componentId));
  if (!row) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  row.focus({ preventScroll: true });
}

// Phone: name and figure, then source and files, then the state. Desktop: four columns.
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-4 md:grid-cols-[minmax(0,1fr)_144px_minmax(0,200px)_minmax(0,220px)] md:items-start";

function NewTabLink({
  href,
  children,
  className,
  mono,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
        mono && "font-mono",
        className,
      )}
    >
      {children}
      {" "}
      <ArrowSquareOutIcon size={LINK_ICON_SIZE} aria-hidden className="inline align-baseline" />
    </Link>
  );
}

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

function FilesText({ row }: { row: ComponentRow }) {
  if (row.fileCount === 0) return null;
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

/** The state of one row: what to do (blocked), where it went (sent earlier), or a quiet Included. */
function StateCell({ row, facilityId }: { row: ComponentRow; facilityId: string }) {
  if (row.state === "blocked" && row.blocked) {
    return (
      <span className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-4 body-small font-medium text-[var(--st-bad)]">
          <WarningIcon size={ICON_SIZE} weight="fill" aria-hidden />
          {STATE_WORD.blocked}
        </span>
        <span className="body-caption text-[var(--color-text-primary)]">{row.blocked.message}</span>
        {row.blocked.fixes.map((fix) => (
          <Link
            key={`${fix.href}:${fix.batchCode ?? ""}`}
            href={fix.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-44 items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline md:min-h-0"
          >
            {fix.batchCode ? `${fix.label} on ${fix.batchCode}` : fix.label}
            <ArrowSquareOutIcon size={LINK_ICON_SIZE} aria-hidden />
          </Link>
        ))}
      </span>
    );
  }
  if (row.state === "earlier" && row.earlier) {
    return (
      <span className="flex flex-col gap-2 body-small text-[var(--color-text-secondary)]">
        <span>{STATE_WORD.earlier}</span>
        {row.earlier.removals.map((removal) => (
          <NewTabLink
            key={removal.id}
            href={certificationRemovalsHref({ facility: facilityId, removal: removal.id })}
            mono
            className="inline-flex min-h-44 items-center body-caption text-[var(--color-text-secondary)] md:min-h-0"
          >
            {removal.code ?? "Earlier Removal"}
          </NewTabLink>
        ))}
      </span>
    );
  }
  return <span className="body-small text-[var(--color-text-tertiary)]">{STATE_WORD.included}</span>;
}

function Row({ row, facilityId, loading }: { row: ComponentRow; facilityId: string; loading: boolean }) {
  return (
    <li
      id={componentRowDomId(row.componentId)}
      tabIndex={-1}
      className={cn(
        ROW_GRID,
        "px-16 py-10 [border-top:var(--row-divider)] focus:outline-2 focus:-outline-offset-2 focus:outline-[var(--color-interaction)]",
      )}
    >
      <span className="body-small text-[var(--color-text-primary)]">{row.name}</span>
      <span className="text-right md:text-left">
        {row.figure && (
          <span
            className={cn(
              "body-small tabular-nums",
              row.figure.quiet
                ? "text-[var(--color-text-tertiary)]"
                : "font-mono text-[var(--color-text-primary)]",
            )}
            data-quiet={row.figure.quiet || undefined}
          >
            {row.figure.text}
          </span>
        )}
      </span>
      {(row.source || row.fileCount > 0) && (
        <span className="col-span-2 flex flex-wrap items-center gap-x-8 gap-y-2 body-small text-[var(--color-text-secondary)] md:col-span-1">
          {row.source}
          <FilesText row={row} />
        </span>
      )}
      <span
        className={cn(
          "col-span-2 md:col-span-1 md:col-start-4",
          row.state === "included" && "hidden md:block",
        )}
      >
        {/* "Included" is a claim the compile has not made yet. */}
        {!(loading && row.state === "included") && <StateCell row={row} facilityId={facilityId} />}
      </span>
    </li>
  );
}

interface ComponentTableProps {
  table: ComponentTableModel;
  facilityId: string;
}

export function ComponentTable({ table, facilityId }: ComponentTableProps) {
  const { batches, groups, rows } = table;
  if (batches.length === 0) return null;
  return (
    <section className="flex flex-col" aria-label="Components">
      <div className="flex flex-col bg-[var(--paper)] [border:var(--panel-border)]">
        <div className="flex flex-col gap-4 bg-[var(--sea)] px-16 py-10">
          {batches.map((batch) => (
            <div key={batch.id} className="flex flex-wrap items-baseline gap-x-12 gap-y-2 body-small">
              <NewTabLink
                href={creditBatchDeepLinkHref(batch.id, facilityId)}
                mono
                className="inline-flex min-h-44 items-center font-medium md:min-h-0"
              >
                {batch.code}
              </NewTabLink>
              <span className="text-[var(--color-text-secondary)]">
                {formatDateRange(batch.startDate, batch.endDate)}
              </span>
              <span className="font-mono tabular-nums text-[var(--color-text-secondary)]">
                {formatTonnes(batch.dryTons, { digits: TONNE_DIGITS })}
              </span>
              {batch.claim?.kind === "here" && (
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  Production emissions in this Removal
                </span>
              )}
              {batch.claim?.kind === "earlier" && (
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  Production emissions sent with{" "}
                  {batch.claim.removalId ? (
                    <NewTabLink
                      href={certificationRemovalsHref({ facility: facilityId, removal: batch.claim.removalId })}
                      mono
                      className="inline-flex min-h-44 items-center text-[var(--color-text-tertiary)] md:min-h-0"
                    >
                      {batch.claim.removalCode ?? "an earlier Removal"}
                    </NewTabLink>
                  ) : (
                    (batch.claim.removalCode ?? "an earlier Removal")
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
        {rows.length > 0 && (
          <>
            <div
              className={cn(
                ROW_GRID,
                "hidden px-16 py-8 body-small font-medium text-[var(--color-text-secondary)] md:grid [border-top:var(--row-divider)]",
              )}
              aria-hidden
            >
              <span>Component</span>
              <span>Figure</span>
              <span>Source</span>
              <span>State</span>
            </div>
            <ul aria-label="Components">
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <li className="px-16 pt-12 pb-2 body-caption font-medium text-[var(--color-text-tertiary)] [border-top:var(--row-divider)]">
                    {group.label}
                  </li>
                  {group.rows.map((row) => (
                    <Row key={row.componentId} row={row} facilityId={facilityId} loading={table.loading} />
                  ))}
                </Fragment>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
