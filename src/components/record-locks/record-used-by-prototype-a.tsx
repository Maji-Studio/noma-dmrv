/**
 * PROTOTYPE ONLY. Variant A "Record rows": the Records list idiom of the
 * Removal sheet (RecordGroup). One group per kind with its icon and count,
 * one quiet line per record (code or name, day, the mass this record gave
 * it), the whole line a link, first three then "Show all N".
 */
"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { TextAction } from "@/components/ui";
import { TraceTile } from "@/components/chain-of-custody/map/trace-tile";
import { cn } from "@/lib/utils";
import { MaybeLink, SHOWN_FIRST, groupRows, kindHeading, kindMeta, type UsedByRow } from "./record-used-by-prototype-shared";

const ROW_DIVIDER = "[border-top:var(--row-divider)] first:[border-top:none]";

function Row({ row }: { row: UsedByRow }) {
  return (
    <li className={ROW_DIVIDER}>
      <MaybeLink
        href={row.href}
        className="group flex min-h-44 items-center gap-12 py-6 body-small hover:bg-[var(--clr-dark-purple-5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]"
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-12">
          <span className={cn("text-[var(--color-text-primary)] group-hover:underline", row.code ? "min-w-0 truncate" : "shrink-0 font-mono")}>{row.title}</span>
          {row.code && <span className="sr-only">{row.code}</span>}
          {row.day && <span className="min-w-0 truncate whitespace-nowrap tabular-nums text-[var(--color-text-secondary)]">{row.day}</span>}
        </span>
        {row.mass && <span className="shrink-0 whitespace-nowrap tabular-nums text-[var(--color-text-primary)]">{row.mass}</span>}
        {row.href && <CaretRightIcon size={14} aria-hidden className="shrink-0 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-primary)]" />}
      </MaybeLink>
    </li>
  );
}

function Group({ kind, rows }: { kind: string; rows: UsedByRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const meta = kindMeta(kind);
  const heading = kindHeading(kind, rows.length);
  const hidden = rows.length - SHOWN_FIRST;
  const shown = showAll || hidden <= 0 ? rows : rows.slice(0, SHOWN_FIRST);

  function revealRest() {
    flushSync(() => setShowAll(true));
    listRef.current?.querySelectorAll<HTMLElement>("a, [aria-label]")[SHOWN_FIRST]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-12 body-small font-medium">
        <TraceTile icon={meta.icon} accent={meta.accent} accentInk={meta.accentInk} />
        <span>{heading}</span>
        {rows.length > 1 && <span className="tabular-nums font-normal text-[var(--color-text-tertiary)]">{rows.length}</span>}
      </h3>
      <ul ref={listRef} className="flex flex-col">
        {shown.map((row) => <Row key={row.key} row={row} />)}
      </ul>
      {hidden > 0 && (
        <TextAction aria-expanded={showAll} onClick={showAll ? () => setShowAll(false) : revealRest}>
          {showAll ? "Show less" : `Show all ${rows.length}`}
          <span className="sr-only"> {heading.toLowerCase()}</span>
        </TextAction>
      )}
    </div>
  );
}

export function UsedByRecordRows({ rows }: { rows: UsedByRow[] }) {
  return (
    <div className="flex flex-col gap-20">
      {groupRows(rows).map((group) => <Group key={group.kind} kind={group.kind} rows={group.rows} />)}
    </div>
  );
}
