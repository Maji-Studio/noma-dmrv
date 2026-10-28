"use client";

import { InfoHint } from "@/components/ui/tooltip";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { cn } from "@/lib/utils";
import { groupState, togglePeg, toggleAll, type ConsentArea } from "./consent-areas";
import { NewTag, Peg, SettledPeg } from "./consent-pegs";

const PEG_COLUMN = "w-56";
const ROW = "border-b border-[var(--color-border-tertiary)]";
const HEAD_CELL = "py-8 text-center body-small font-medium text-[var(--color-text-secondary)]";

/**
 * One row per area with a read peg and a write peg. Scopes in `allowed` are
 * settled ticks, scopes in `undecided` are pegs, areas in `newAreas` lead the
 * board with a New marker. Areas without a write scope show only the read peg.
 */
export function ConsentPegBoard({ areas, allowed, undecided, newAreas, ticked, onChange, clientName, disabled, invalid = false, errorId }: {
  areas: readonly ConsentArea[];
  allowed: readonly ApiScope[];
  /** Offered scopes not yet allowed: the ones the person decides on. */
  undecided: readonly ApiScope[];
  /** Entities that carry the New marker and move to the top. */
  newAreas: ReadonlySet<string>;
  ticked: readonly ApiScope[];
  onChange: (next: ApiScope[]) => void;
  clientName: string;
  disabled: boolean;
  /** The "choose at least one" error is showing: red pegs that point at it. */
  invalid?: boolean;
  errorId?: string;
}) {
  const fresh = areas.filter((area) => newAreas.has(area.entity));
  const rest = areas.filter((area) => !newAreas.has(area.entity));
  const writable = rest.filter((area) => area.write);
  const readOnly = rest.filter((area) => !area.write);
  const reads = areas.flatMap((area) => area.read && undecided.includes(area.read) ? [area.read] : []);
  const writes = areas.flatMap((area) => area.write && undecided.includes(area.write) ? [area.write] : []);
  const hasWrites = areas.some((area) => area.write);

  const row = (area: ConsentArea) => (
    <AreaRow key={area.entity} area={area} allowed={allowed} undecided={undecided} ticked={ticked} isNew={newAreas.has(area.entity)} withWrite={hasWrites}
      disabled={disabled} invalid={invalid} errorId={errorId} onToggle={(kind, on) => onChange(togglePeg(ticked, area, kind, on))} />
  );

  return (
    <table className="w-full border-collapse body-small">
      <caption className="sr-only">What {clientName} can read and write, by area</caption>
      <thead>
        <tr className="border-b border-[var(--color-border-secondary)]">
          <th scope="col" className="py-8 text-left body-small font-medium text-[var(--color-text-secondary)]">Area</th>
          <th scope="col" className={cn(HEAD_CELL, PEG_COLUMN)}>Read</th>
          {hasWrites && (
            <th scope="col" className={cn(HEAD_CELL, PEG_COLUMN)}>
              <span className="inline-flex items-center justify-center gap-2">
                Write
                <InfoHint label="More about Write">Write lets {clientName} create and change records in that area. Apps never delete records.</InfoHint>
              </span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        <tr className={ROW}>
          <th scope="row" className="py-4 pr-8 text-left body-small font-medium">All areas</th>
          <td className="text-center">
            {reads.length ? <Peg state={groupState(ticked, reads)} label="All areas, read" disabled={disabled} invalid={invalid} describedBy={invalid ? errorId : undefined}
              onChange={(on) => onChange(toggleAll(ticked, areas, undecided, "read", on))} /> : <SettledPeg label="All areas, read" />}
          </td>
          {hasWrites && (
            <td className="text-center">
              {writes.length ? <Peg state={groupState(ticked, writes)} label="All areas, write" disabled={disabled} invalid={invalid} describedBy={invalid ? errorId : undefined}
                onChange={(on) => onChange(toggleAll(ticked, areas, undecided, "write", on))} /> : <SettledPeg label="All areas, write" />}
            </td>
          )}
        </tr>
        {fresh.map(row)}
        {writable.map(row)}
      </tbody>
      {readOnly.length > 0 && hasWrites && (
        <tbody>
          <tr className="border-b border-[var(--color-border-secondary)]">
            <th scope="colgroup" colSpan={3} className="pt-16 pb-8 text-left body-small font-medium text-[var(--color-text-secondary)]">Read only</th>
          </tr>
          {readOnly.map(row)}
        </tbody>
      )}
      {readOnly.length > 0 && !hasWrites && <tbody>{readOnly.map(row)}</tbody>}
    </table>
  );
}

function AreaRow({ area, allowed, undecided, ticked, isNew, withWrite, disabled, invalid, errorId, onToggle }: {
  area: ConsentArea;
  allowed: readonly ApiScope[];
  undecided: readonly ApiScope[];
  ticked: readonly ApiScope[];
  isNew: boolean;
  withWrite: boolean;
  disabled: boolean;
  invalid: boolean;
  errorId?: string;
  onToggle: (kind: "read" | "write", on: boolean) => void;
}) {
  const cell = (scope: ApiScope | null, kind: "read" | "write") => {
    const label = `${area.label}, ${kind}`;
    if (!scope) return <span className="sr-only">Not applicable</span>;
    if (allowed.includes(scope)) return <SettledPeg label={label} />;
    if (!undecided.includes(scope)) return <span className="sr-only">Not applicable</span>;
    return <Peg state={ticked.includes(scope) ? "on" : "off"} label={label} disabled={disabled} invalid={invalid} describedBy={invalid ? errorId : undefined} onChange={(on) => onToggle(kind, on)} />;
  };
  return (
    <tr className={cn(ROW, isNew && "bg-[var(--color-background-interaction-light)]")}>
      <th scope="row" className="py-4 pr-8 text-left font-normal">
        <span className="flex flex-wrap items-center gap-8">{area.label}{isNew && <NewTag />}</span>
      </th>
      <td className="text-center">{cell(area.read, "read")}</td>
      {withWrite && <td className="text-center">{cell(area.write, "write")}</td>}
    </tr>
  );
}
