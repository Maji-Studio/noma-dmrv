/**
 * The read view of a credit batch's emission lines: Line | State | Sources |
 * Total | actions, grouped by template group in template order. Each row is
 * an accordion: the name button (aria-expanded) toggles the body, and the
 * whole header is a larger click target. Add manual entry sits on the right
 * of the row; the chips, links and the ⋯ menu stay separate controls.
 *
 * A list, not a table, so the row can be one click target and phones can
 * stack the same cells into a card.
 */
"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { CaretDownIcon, CaretRightIcon, ChatTextIcon, DotsThreeVerticalIcon, FunnelSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, DropdownMenu, EmptyState } from "@/components/ui";
import type { EmissionBatchScope } from "@/hooks/use-emission-entries";
import { certificationRemovalTemplatesHref } from "@/lib/certification/links";
import { cn } from "@/lib/utils";
import { EmissionLineAccordionBody } from "./emission-line-accordion-body";
import { EmissionLineBadge } from "./emission-line-badge";
import {
  addEntryRefusal,
  groupLines,
  isOpen,
  lineRecords,
  lineTotalText,
  openSourceLabel,
  recordsHref,
  valueEntries,
  type EmissionEntry,
  type EmissionLine,
} from "./emission-line-display";
import type { EntryFormMode } from "./manual-entry-form";
import { SourceChips } from "./emission-source-chips";

/** Line | State | Sources | Total | actions; phones stack the cells into a card. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-8 md:grid-cols-[minmax(0,1.25fr)_148px_minmax(0,1fr)_minmax(120px,168px)_212px] md:items-center md:gap-x-16";
const ACTION_SIZE = "size-44";
/** Phones: the add action gets its own full-width row under the card; wide: it sits right of the Total. */
const ADD_BUTTON = "col-span-2 row-start-4 w-full md:col-span-1 md:row-start-auto md:w-auto";
const MENU_CELL = "col-start-2 row-start-1 -mt-8 -mr-8 md:m-0 md:col-auto";

export interface LineActions {
  toggle: (line: EmissionLine) => void;
  form: (line: EmissionLine, mode: EntryFormMode) => void;
  /** Expands the row and opens its comment editor. */
  comment: (line: EmissionLine) => void;
  editingComment: (line: EmissionLine, editing: boolean) => void;
  deleteEntry: (line: EmissionLine, entry: EmissionEntry) => void;
}

/** The Undo bar of a deleted entry, shown under that row. */
export interface RowUndo { componentId: string; bar: ReactNode }

interface EmissionLineListProps {
  lines: EmissionLine[];
  grouped: boolean;
  scope: EmissionBatchScope;
  actions: LineActions;
  expanded: ReadonlySet<string>;
  editingCommentId: string | null;
  undo: RowUndo | null;
  /** False while manual entries are switched off: rows only expand. */
  canWrite: boolean;
  /** Label of the active state chip, for the filtered empty state. */
  filterLabel: string | null;
  onClearFilter: () => void;
}

export function EmissionLineList({ lines, grouped, scope, actions, expanded, editingCommentId, undo, canWrite, filterLabel, onClearFilter }: EmissionLineListProps) {
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
    <LineRow
      key={line.componentId}
      line={line}
      showGroup={showGroup}
      scope={scope}
      actions={actions}
      canWrite={canWrite}
      expanded={expanded.has(line.componentId)}
      editingComment={editingCommentId === line.componentId}
      undoBar={undo?.componentId === line.componentId ? undo.bar : null}
    />
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
  expanded: boolean;
  editingComment: boolean;
  undoBar: ReactNode;
}

function LineRow({ line, showGroup, scope, actions, canWrite, expanded, editingComment, undoBar }: LineRowProps) {
  const total = lineTotalText(line);
  const quietTotal = !line.total && line.state !== "confirmedZero" && valueEntries(line).every((entry) => entry.values.length < 2);
  const bodyId = `line-body-${line.componentId}`;
  const Caret = expanded ? CaretDownIcon : CaretRightIcon;
  return (
    <li className="[border-top:var(--row-divider)]">
      <div
        onClick={() => actions.toggle(line)}
        className={cn(
          "group cursor-pointer px-16 py-12 hover:bg-[var(--row-hover-bg-solid)]",
          ROW_GRID,
          isOpen(line) && "bg-[var(--st-wait-bg)]/40",
        )}
      >
        <div className="col-start-1 row-start-1 min-w-0">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={(event) => {
              event.stopPropagation();
              actions.toggle(line);
            }}
            className="inline-flex min-h-24 items-center gap-6 text-left body-small font-medium underline-offset-4 group-hover:underline"
          >
            <Caret size={14} weight="bold" aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
            {line.displayName}
            {line.comment && (
              <>
                <ChatTextIcon size={14} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
                <span className="sr-only">, has a comment</span>
              </>
            )}
          </button>
          {showGroup && <span className="block pl-20 body-caption text-[var(--color-text-tertiary)]">{line.groupName}</span>}
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
            <SourceChips line={line} ids={scope} onEntries={() => !expanded && actions.toggle(line)} />
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
          className="contents md:col-start-5 md:flex md:items-center md:justify-end md:gap-4"
          onClick={(event) => event.stopPropagation()}
        >
          <AddEntryButton line={line} canWrite={canWrite} onForm={actions.form} />
          <RowMenu line={line} scope={scope} actions={actions} canWrite={canWrite} />
        </div>
      </div>
      {undoBar}
      {expanded && (
        <EmissionLineAccordionBody
          id={bodyId}
          line={line}
          scope={scope}
          canWrite={canWrite}
          editingComment={editingComment}
          onEditingComment={(editing) => actions.editingComment(line, editing)}
          onForm={(mode) => actions.form(line, mode)}
          onDeleteEntry={actions.deleteEntry}
        />
      )}
    </li>
  );
}

/** Add manual entry on the right of the row; a one-entry line offers Edit instead. */
function AddEntryButton({ line, canWrite, onForm }: { line: EmissionLine; canWrite: boolean; onForm: LineActions["form"] }) {
  if (!canWrite || line.entryPolicy === "none" || line.state === "needsSetup") return null;
  const single = line.entryPolicy === "single" ? valueEntries(line)[0] : undefined;
  if (single) {
    return (
      <Button size="small" variant="weak" className={ADD_BUTTON} aria-label={`Edit manual entry on ${line.displayName}`} onClick={() => onForm(line, { kind: "edit", entry: single })}>
        Edit manual entry
      </Button>
    );
  }
  if (addEntryRefusal(line)) return null;
  return (
    <Button size="small" variant="weak" className={ADD_BUTTON} aria-label={`Add manual entry on ${line.displayName}`} onClick={() => onForm(line, { kind: "add" })}>
      Add manual entry
    </Button>
  );
}

/** The short row menu: the records page, template review, the comment. */
function RowMenu({ line, scope, actions, canWrite }: { line: EmissionLine; scope: EmissionBatchScope; actions: LineActions; canWrite: boolean }) {
  const records = lineRecords(line);
  const upstream = records ? (
    <DropdownMenu.Item key="open" render={<Link href={recordsHref(records, scope)} />}>
      {openSourceLabel(records.source)}
    </DropdownMenu.Item>
  ) : null;
  const setup = line.state === "needsSetup" ? (
    <DropdownMenu.Item key="setup" render={<Link href={certificationRemovalTemplatesHref(scope.facilityId)} />}>
      Open template review
    </DropdownMenu.Item>
  ) : null;
  const comment = canWrite && line.state !== "needsSetup" ? (
    <DropdownMenu.Item key="comment" onClick={() => actions.comment(line)}>
      {line.comment ? "Edit comment" : "Comment"}
    </DropdownMenu.Item>
  ) : null;
  const items = [upstream, setup, comment].filter(Boolean);
  if (!items.length) return null;
  return (
    <span className={MENU_CELL}>
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
    </span>
  );
}
