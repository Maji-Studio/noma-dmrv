/**
 * The Sources cell of a line: where its figure comes from, as chips.
 *
 *   wash (sea fill)         records made on another page; links upstream
 *   dashed warning outline  the records source exists but holds nothing
 *   plain outline           manual entries typed on this page
 */
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Icon } from "@phosphor-icons/react";
import {
  ArrowUpRightIcon,
  GearSixIcon,
  PencilSimpleIcon,
  PlantIcon,
  TruckIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { EMISSION_LINE_STATE_LABELS } from "@/lib/certification/emission-lines";
import { cn } from "@/lib/utils";
import {
  hasRecordsFigure,
  lineRecords,
  manualEntriesText,
  openSourceLabel,
  recordsChipText,
  recordsHref,
  recordsText,
  stoppedEntries,
  valueEntries,
  type EmissionLine,
  type RecordsSource,
} from "./emission-line-display";

export const SOURCE_ICON: Record<RecordsSource, Icon> = {
  productionRuns: GearSixIcon,
  transportLegs: TruckIcon,
  deliveries: TruckIcon,
  applications: PlantIcon,
};

const CHIP = "inline-flex min-h-28 items-center gap-6 whitespace-nowrap px-8 body-caption";
const ICON_SIZE = 14;
const ARROW_SIZE = 12;

interface SourceChipsProps {
  line: EmissionLine;
  ids: { facilityId: string; creditBatchId: string };
  /** Opens the drawer at the entries. Omit for read-only chips (bulk grid). */
  onEntries?: () => void;
  /** Read-only chips: no links, no buttons. */
  interactive?: boolean;
  /** Show "No records source" when there are no chips at all. */
  quietText?: boolean;
  /** Shown in place of the quiet text when there are no chips, such as Add manual entry. */
  emptyAction?: ReactNode;
}

export function SourceChips({ line, ids, onEntries, interactive = true, quietText = true, emptyAction }: SourceChipsProps) {
  if (line.state === "needsSetup") {
    return <span className="body-caption text-[var(--color-text-tertiary)]">{EMISSION_LINE_STATE_LABELS.needsSetup}</span>;
  }
  const records = lineRecords(line);
  const chips: ReactNode[] = [];
  if (records) {
    const SourceIcon = SOURCE_ICON[records.source];
    const gap = !hasRecordsFigure(records);
    const look = gap
      ? "border border-dashed border-[var(--st-wait-border)] text-[var(--st-wait)]"
      : "border border-transparent bg-[var(--sea)] text-[var(--color-text-primary)]";
    const body = (
      <>
        <SourceIcon size={ICON_SIZE} aria-hidden="true" />
        {recordsChipText(records)}
        {interactive && <ArrowUpRightIcon size={ARROW_SIZE} weight="bold" aria-hidden="true" className="text-[var(--color-text-tertiary)]" />}
      </>
    );
    chips.push(
      interactive ? (
        <Link
          key="records"
          href={recordsHref(records, ids)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`${recordsText(records)}. ${openSourceLabel(records.source)}`}
          className={cn(CHIP, look, "hover:border-[var(--color-border-primary)]")}
        >
          {body}
        </Link>
      ) : (
        <span key="records" className={cn(CHIP, look)} aria-label={recordsText(records)}>{body}</span>
      ),
    );
  }

  const entryChips: ReactNode[] = [];
  const values = valueEntries(line);
  if (values.length) {
    const missing = values.some((entry) => !entry.hasEvidence);
    const text = manualEntriesText(values.length);
    entryChips.push(
      <EntryChip key="entries" label={missing ? `${text}, file missing` : text} interactive={interactive} onClick={onEntries}>
        {missing ? (
          <WarningIcon size={ICON_SIZE} weight="bold" aria-hidden="true" className="text-[var(--st-wait)]" />
        ) : (
          <PencilSimpleIcon size={ICON_SIZE} aria-hidden="true" />
        )}
        {text}
      </EntryChip>,
    );
  }
  const stopped = stoppedEntries(line);
  if (stopped.length) {
    const text = manualEntriesText(stopped.length);
    entryChips.push(
      <EntryChip key="stopped" label={`${text}, stopped counting`} interactive={interactive} onClick={onEntries} dim>
        <PencilSimpleIcon size={ICON_SIZE} aria-hidden="true" />
        <span className="line-through">{text}</span>
        <span>stopped</span>
      </EntryChip>,
    );
  }
  if (chips.length && entryChips.length) {
    chips.push(<span key="plus" aria-hidden="true" className="body-caption text-[var(--color-text-tertiary)]">+</span>);
  }
  chips.push(...entryChips);

  if (!chips.length) {
    if (emptyAction) return emptyAction;
    if (!quietText) return null;
    const text = line.entryPolicy === "single" ? "One manual entry per credit batch" : "No records source";
    return <span className="body-caption text-[var(--color-text-tertiary)]">{text}</span>;
  }
  return <span className="flex flex-wrap items-center gap-x-6 gap-y-4">{chips}</span>;
}

interface EntryChipProps {
  children: ReactNode;
  label: string;
  interactive: boolean;
  onClick?: () => void;
  dim?: boolean;
}

function EntryChip({ children, label, interactive, onClick, dim }: EntryChipProps) {
  const look = cn(CHIP, "border border-[var(--color-border-tertiary)] bg-[var(--color-background-white)]", dim && "text-[var(--color-text-tertiary)]");
  if (!interactive || !onClick) {
    return <span className={look} aria-label={label}>{children}</span>;
  }
  return (
    <button
      type="button"
      aria-label={`${label}. Show manual entries`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(look, "hover:border-[var(--color-border-primary)]")}
    >
      {children}
    </button>
  );
}
