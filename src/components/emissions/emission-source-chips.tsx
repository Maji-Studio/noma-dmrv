/**
 * The Sources cell of a line: where its figure comes from, as chips.
 *
 *   wash (sea fill)         records made on another page; links upstream
 *   dashed warning outline  the records source exists but holds nothing
 *   plain outline           manual entries typed on this page
 *
 * Phones drop the boxes: each source reads as icon and text (records keep
 * their link underline and ↗), so the line's state badge stays the only box
 * on the row's meta line.
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
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { CENTRED_HIT_AREA, INLINE_HIT_AREA } from "@/components/ui/touch-target";
import {
  COUNTED_ON_PREFIX,
  countedOnHref,
  isCountedElsewhere,
  isRecordsGap,
  lineRecords,
  manualEntriesText,
  openSourceLabel,
  recordsChipText,
  recordsHref,
  recordsText,
  stoppedEntries,
  valueEntries,
  type EmissionLine,
  type LineRecords,
  type RecordsSource,
} from "./emission-line-display";

export const SOURCE_ICON: Record<RecordsSource, Icon> = {
  productionRuns: GearSixIcon,
  transportLegs: TruckIcon,
  deliveries: TruckIcon,
  applications: PlantIcon,
};

const CHIP_BASE = "inline-flex min-h-28 items-center gap-6 body-caption md:px-8";
const CHIP = `${CHIP_BASE} whitespace-nowrap`;
/** The counted-on chip may hold several codes, so it wraps between them (each code stays unbreakable). */
const WRAPPING_CHIP = `${CHIP_BASE} flex-wrap`;
/** Phones: the records link reads like the open row's records link, underlined. */
const PHONE_LINK = "max-md:underline max-md:decoration-[color:var(--color-border-primary)] max-md:underline-offset-4";
const ICON_SIZE = 14;
const ARROW_SIZE = 12;

interface SourceChipsProps {
  line: EmissionLine;
  ids: { facilityId: string; creditBatchId: string };
  /** Opens the drawer at the entries. Omit for read-only chips (bulk grid). */
  onEntries?: () => void;
  /** Read-only chips: no links, no buttons. */
  interactive?: boolean;
  /** Show "No automatic datapoints" when there are no chips at all. */
  quietText?: boolean;
  /** Shown in place of the quiet text when there are no chips, such as Add manual entry. */
  emptyAction?: ReactNode;
}

/** "Counted on CB-26-001", each code a link to that credit batch's Emissions tab. */
export function CountedOnLinks({ records, facilityId, interactive = true }: {
  records: LineRecords & { countedOn: NonNullable<LineRecords["countedOn"]> };
  facilityId: string;
  interactive?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-6 gap-y-8">
      <span>{COUNTED_ON_PREFIX}</span>
      {records.countedOn.map((batch, index) => (
        <span key={batch.creditBatchId}>
          {interactive ? (
            <Link
              href={countedOnHref(batch.creditBatchId, facilityId)}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Open credit batch ${batch.code}`}
              className={cn(RECORD_CODE_LINK, INLINE_HIT_AREA)}
            >
              {batch.code}
            </Link>
          ) : <span className="font-mono whitespace-nowrap">{batch.code}</span>}
          {index < records.countedOn.length - 1 && ","}
        </span>
      ))}
    </span>
  );
}

export function SourceChips({ line, ids, onEntries, interactive = true, quietText = true, emptyAction }: SourceChipsProps) {
  if (line.state === "needsSetup") {
    return <span className="body-caption text-[var(--color-text-tertiary)]">{EMISSION_LINE_STATE_LABELS.needsSetup}</span>;
  }
  const records = lineRecords(line);
  const chips: ReactNode[] = [];
  if (records) {
    const SourceIcon = SOURCE_ICON[records.source];
    const gap = isRecordsGap(records);
    const look = gap
      ? "text-[var(--st-wait)] md:border md:border-dashed md:border-[var(--st-wait-border)]"
      : "text-[var(--color-text-primary)] md:border md:border-transparent md:bg-[var(--sea)]";
    const body = (
      <>
        <SourceIcon size={ICON_SIZE} aria-hidden="true" />
        {recordsChipText(records)}
        {interactive && !isCountedElsewhere(records) && <ArrowUpRightIcon size={ARROW_SIZE} weight="bold" aria-hidden="true" className="text-[var(--color-text-tertiary)]" />}
      </>
    );
    chips.push(
      isCountedElsewhere(records) ? (
        <span key="records" className={cn(WRAPPING_CHIP, look)} aria-label={recordsText(records)}>
          <SourceIcon size={ICON_SIZE} aria-hidden="true" />
          <CountedOnLinks records={records} facilityId={ids.facilityId} interactive={interactive} />
        </span>
      ) : interactive ? (
        <Link
          key="records"
          href={recordsHref(records, ids)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`${recordsText(records)}. ${openSourceLabel(records.source)}`}
          className={cn(CHIP, look, CENTRED_HIT_AREA, PHONE_LINK, "md:hover:border-[var(--color-border-primary)]")}
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
    // The + travels with the chip after it, so a wrap never leaves it at a line end.
    const [first, ...rest] = entryChips;
    chips.push(
      <span key="plus" className="inline-flex items-center gap-x-8 md:gap-x-6">
        <span aria-hidden="true" className="body-caption text-[var(--color-text-tertiary)]">+</span>
        {first}
      </span>,
      ...rest,
    );
  } else {
    chips.push(...entryChips);
  }

  if (!chips.length) {
    if (emptyAction) return emptyAction;
    if (!quietText) return null;
    const text = line.entryPolicy === "single" ? "One manual entry per credit batch" : "No automatic datapoints";
    return <span className="body-caption text-[var(--color-text-tertiary)]">{text}</span>;
  }
  return <span className="flex flex-wrap items-center gap-x-8 md:gap-x-6 md:gap-y-4">{chips}</span>;
}

interface EntryChipProps {
  children: ReactNode;
  label: string;
  interactive: boolean;
  onClick?: () => void;
  dim?: boolean;
}

function EntryChip({ children, label, interactive, onClick, dim }: EntryChipProps) {
  const look = cn(CHIP, "md:border md:border-[var(--color-border-tertiary)] md:bg-[var(--color-background-white)]", dim && "text-[var(--color-text-tertiary)]");
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
      className={cn(look, CENTRED_HIT_AREA, "md:hover:border-[var(--color-border-primary)]")}
    >
      {children}
    </button>
  );
}
