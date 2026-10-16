/**
 * The read view of a credit batch's emission lines: Line | State | Sources |
 * Total | actions, grouped by template group in template order. The whole row
 * opens the ledger drawer; the name is its keyboard target, while the chips,
 * the Nothing to record icon and the ⋯ menu stay separate controls.
 *
 * A list, not a table, so the row can be one click target and phones can
 * stack the same cells into a card.
 */
"use client";

import { Fragment } from "react";
import Link from "next/link";
import { DotsThreeVerticalIcon, FunnelSimpleIcon, MinusCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, DropdownMenu, EmptyState, Tooltip } from "@/components/ui";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { certificationRemovalTemplatesHref } from "@/lib/certification/links";
import { cn } from "@/lib/utils";
import { EmissionLineBadge } from "./emission-line-badge";
import {
  addEntryRefusal,
  groupLines,
  nothingRefusalText,
  isOpen,
  isRecordsGap,
  lineRecords,
  lineTotalText,
  nothingApplies,
  nothingRefusal,
  openSourceLabel,
  recordsHref,
  valueEntries,
  type EmissionLine,
} from "./emission-line-display";
import { SourceChips } from "./emission-source-chips";

/** Line | State | Sources | Total | actions; phones stack the cells into a card. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-8 md:grid-cols-[minmax(0,1.25fr)_148px_minmax(0,1fr)_minmax(120px,168px)_88px] md:items-center md:gap-x-16";
const ACTION_SIZE = "size-44";

export interface LineActions {
  open: (line: EmissionLine, options?: { add?: boolean }) => void;
  nothing: (line: EmissionLine) => void;
}

interface EmissionLineListProps {
  lines: EmissionLine[];
  grouped: boolean;
  scope: EmissionBatchScope;
  actions: LineActions;
  /** False while manual entries are switched off: rows only open the drawer. */
  canWrite: boolean;
  /** Label of the active state chip, for the filtered empty state. */
  filterLabel: string | null;
  onClearFilter: () => void;
}

export function EmissionLineList({ lines, grouped, scope, actions, canWrite, filterLabel, onClearFilter }: EmissionLineListProps) {
  if (!lines.length) {
    return (
      <div className="bg-[var(--paper)] p-16 [border:var(--panel-border)]">
        <EmptyState
          padding="sm"
          icon={<FunnelSimpleIcon size={32} />}
          title={filterLabel ? `No lines in "${filterLabel}"` : "No emission lines"}
          description={filterLabel ? "Clear the filter to see every line of this credit batch." : undefined}
          action={filterLabel ? <Button variant="default" onClick={onClearFilter}>Show all lines</Button> : undefined}
        />
      </div>
    );
  }
  const row = (line: EmissionLine, showGroup: boolean) => (
    <LineRow key={line.componentId} line={line} showGroup={showGroup} scope={scope} actions={actions} canWrite={canWrite} />
  );
  return (
    <div className="bg-[var(--paper)] [border:var(--panel-border)]">
      <div aria-hidden="true" className={cn(ROW_GRID, "hidden bg-[var(--sea)] px-16 py-10 body-small font-medium text-[var(--color-text-secondary)] md:grid")}>
        <span>Line</span>
        <span>State</span>
        <span>Sources</span>
        <span className="text-right">Total</span>
        <span />
      </div>
      <ul aria-label="Emission lines">
        {grouped
          ? groupLines(lines).map((group) => (
              <Fragment key={group.key}>
                <li className="px-16 pt-16 pb-4 body-caption font-medium text-[var(--color-text-tertiary)] [border-top:var(--row-divider)] first:[border-top:none]">
                  {group.label}
                </li>
                {group.lines.map((line) => row(line, false))}
              </Fragment>
            ))
          : lines.map((line) => row(line, true))}
      </ul>
    </div>
  );
}

interface LineRowProps {
  line: EmissionLine;
  showGroup: boolean;
  scope: EmissionBatchScope;
  actions: LineActions;
  canWrite: boolean;
}

function LineRow({ line, showGroup, scope, actions, canWrite }: LineRowProps) {
  const total = lineTotalText(line);
  const quietTotal = !line.total && line.state !== "confirmedZero" && valueEntries(line).every((entry) => entry.values.length < 2);
  return (
    <li
      onClick={() => actions.open(line)}
      className={cn(
        "group cursor-pointer px-16 py-12 [border-top:var(--row-divider)] hover:bg-[var(--row-hover-bg-solid)]",
        ROW_GRID,
        isOpen(line) && "bg-[var(--st-wait-bg)]/40",
      )}
    >
      <div className="col-start-1 row-start-1 min-w-0">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={(event) => {
            event.stopPropagation();
            actions.open(line);
          }}
          className="min-h-24 text-left body-small font-medium underline-offset-4 group-hover:underline"
        >
          {line.displayName}
        </button>
        {showGroup && <span className="block body-caption text-[var(--color-text-tertiary)]">{line.groupName}</span>}
      </div>
      <div className="col-start-1 row-start-3 self-center md:col-start-2 md:row-start-1">
        <EmissionLineBadge state={line.state} />
      </div>
      <div className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
        {line.state === "needsSetup" ? (
          <Link
            href={certificationRemovalTemplatesHref(scope.facilityId)}
            onClick={(event) => event.stopPropagation()}
            className="body-caption text-[var(--color-text-secondary)] underline underline-offset-4 hover:text-[var(--color-text-primary)]"
          >
            An admin sets this line up in the template review
          </Link>
        ) : (
          <SourceChips line={line} ids={scope} onEntries={() => actions.open(line)} />
        )}
      </div>
      <div
        className={cn(
          "col-start-2 row-start-3 self-center text-right body-small font-medium tabular-nums",
          "md:col-start-4 md:row-start-1",
          quietTotal && "font-normal text-[var(--color-text-tertiary)]",
        )}
      >
        {total}
      </div>
      <div
        className="col-start-2 row-start-1 -mt-8 -mr-8 flex items-start justify-end md:col-start-5 md:m-0 md:items-center"
        onClick={(event) => event.stopPropagation()}
      >
        {canWrite && <NothingButton line={line} onNothing={actions.nothing} />}
        <RowMenu line={line} scope={scope} actions={actions} canWrite={canWrite} />
      </div>
    </li>
  );
}

/**
 * One-tap Nothing to record. Always visible where it is allowed. Where it is
 * refused it sits disabled with its reason as the tooltip, shown on row hover
 * or focus on desktop only; phones read the reason in the ⋯ menu.
 */
function NothingButton({ line, onNothing }: { line: EmissionLine; onNothing: (line: EmissionLine) => void }) {
  if (!nothingApplies(line)) return <span aria-hidden="true" className={cn("hidden md:block", "w-44")} />;
  const refusal = nothingRefusal(line);
  const base = cn("inline-flex items-center justify-center", ACTION_SIZE);
  if (refusal) {
    return (
      <Tooltip content={nothingRefusalText(refusal)}>
        <button
          type="button"
          aria-disabled="true"
          aria-label={nothingRefusalText(refusal)}
          onClick={(event) => event.preventDefault()}
          className={cn(
            base,
            "hidden cursor-not-allowed text-[var(--color-text-tertiary)] md:inline-flex md:opacity-0",
            "md:group-hover:opacity-50 md:group-focus-within:opacity-50 md:focus-visible:opacity-50",
          )}
        >
          <MinusCircleIcon size={18} aria-hidden="true" />
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Nothing to record">
      <button
        type="button"
        aria-label="Nothing to record"
        onClick={() => onNothing(line)}
        className={cn(base, "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-medium)] hover:text-[var(--color-text-primary)]")}
      >
        <MinusCircleIcon size={18} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function MenuItemBody({ label, reason }: { label: string; reason?: string | null }) {
  return (
    <span className="flex flex-col">
      <span>{label}</span>
      {reason && <span className="body-caption">{reason}</span>}
    </span>
  );
}

/** The short row menu: Add manual entry, the records page, Nothing to record, Line description. */
function RowMenu({ line, scope, actions, canWrite }: { line: EmissionLine; scope: EmissionBatchScope; actions: LineActions; canWrite: boolean }) {
  const records = lineRecords(line);
  const upstream = records ? (
    <DropdownMenu.Item key="open" render={<Link href={recordsHref(records, scope)} />}>
      {openSourceLabel(records.source)}
    </DropdownMenu.Item>
  ) : null;
  const addRefusal = addEntryRefusal(line);
  const add = canWrite && line.entryPolicy !== "none" && line.state !== "needsSetup" ? (
    <DropdownMenu.Item key="add" disabled={!!addRefusal} onClick={() => actions.open(line, { add: true })}>
      <MenuItemBody label="Add manual entry" reason={addRefusal} />
    </DropdownMenu.Item>
  ) : null;
  const refusal = nothingRefusal(line);
  const nothing = canWrite && nothingApplies(line) ? (
    <DropdownMenu.Item key="nothing" disabled={!!refusal} onClick={() => actions.nothing(line)}>
      <MenuItemBody label="Nothing to record" reason={refusal ? nothingRefusalText(refusal) : null} />
    </DropdownMenu.Item>
  ) : null;
  const setup = line.state === "needsSetup" ? (
    <DropdownMenu.Item key="setup" render={<Link href={certificationRemovalTemplatesHref(scope.facilityId)} />}>
      Open template review
    </DropdownMenu.Item>
  ) : null;
  const description = (
    <DropdownMenu.Item key="description" onClick={() => actions.open(line)}>
      Line description
    </DropdownMenu.Item>
  );
  // Where the records hold nothing, the fix is usually upstream, so that page comes first.
  const items = isRecordsGap(records) ? [upstream, add, nothing, description] : [add, upstream, nothing, setup, description];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        render={
          <Button
            variant="noOutline"
            size="icon"
            aria-label={`Actions for ${line.displayName}`}
            className={cn(ACTION_SIZE, "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]")}
          />
        }
      >
        <DotsThreeVerticalIcon size={20} weight="bold" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="max-w-[280px]">{items}</DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
