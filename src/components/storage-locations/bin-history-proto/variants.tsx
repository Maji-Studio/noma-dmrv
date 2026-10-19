/**
 * PROTOTYPE (issue #1004, round 2): three calmer takes on variant A of round 1.
 * All three headline the wet mass with the dry biochar under it, and move every
 * other figure into the history. They differ in how the history is laid out:
 *  - A1: one flat table; moisture, wet stock after and dry biochar after are columns.
 *  - A2: rows grouped by day; an entry opens into a small parts table.
 *  - A3: one "in the bin now" table up top; the history is plain sentences, no running balance.
 */
"use client";

import { SecondaryFigure } from "@/components/ui/secondary-figure";
import { InfoHint } from "@/components/ui/tooltip";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { WET_STOCK_DEFINITION } from "@/lib/output-stock/labels";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import {
  DRY_BIOCHAR, NO_MOISTURE_REASON, buildRows, correctionSentence, dateTimeLabel, dayLabel, kg, nowOf, partsOf, sentence, signedKg, timeLabel,
  type Move, type Part, type ProtoState, type Row, type Snapshot,
} from "./parts";
import type { VariantKey } from "./switcher";

const PERCENT = 100;
const MUTED = "text-[var(--color-text-tertiary)]";
const SECONDARY = "text-[var(--color-text-secondary)]";
const RULE = "border-b border-[var(--color-border-secondary)]";
const TH = `py-8 pr-12 text-left font-normal body-caption ${MUTED}`;

function useProtoState(): ProtoState {
  return useSearchParams().get("state") === "nomoisture" ? "nomoisture" : "full";
}

/** Headline: wet mass, with the dry biochar under it. With no wet mass the dry biochar leads and a reason says why. */
function Headline({ now }: { now: Snapshot }) {
  const dry = <SecondaryFigure label={DRY_BIOCHAR} value={kg(now.biochar)} />;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-6 body-large font-medium tabular-nums">
        {now.wet === null ? `${kg(now.biochar)} dry biochar` : `${kg(now.wet)} wet mass`}
        <InfoHint label="About wet mass">{WET_STOCK_DEFINITION}</InfoHint>
      </p>
      {now.wet === null ? <p className={`body-caption ${SECONDARY}`}>{NO_MOISTURE_REASON}</p> : dry}
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className={`inline-flex items-center border border-[var(--color-border-tertiary)] px-6 py-2 body-caption-fit whitespace-nowrap ${SECONDARY}`}>{children}</span>;
}

/** The sentence of a row, struck when a correction replaced it, with its chip. */
function Sentence({ row }: { row: Row }) {
  const { move } = row;
  const label = row.corrected ? correctionSentence(move) : sentence(move);
  return (
    <span className="flex flex-wrap items-center gap-6 body-small font-medium">
      <span className={row.replacedBy ? `line-through ${MUTED}` : undefined}>{label}</span>
      {row.replacedBy && <Chip>Replaced</Chip>}
    </span>
  );
}

function ModeRow({ move }: { move: Move }) {
  return <p className={`${RULE} py-10 body-caption ${SECONDARY}`}><span className="tabular-nums">{dateTimeLabel(move.at)}</span> {move.caption}</p>;
}

function moisture(move: Move): string | null {
  return move.moisture === null ? null : `${formatMoisturePercent(move.moisture)} moisture`;
}

/** A1: every figure is a column. Phone: the same figures, one line each, top to bottom. */
function VariantA1({ rows }: { rows: Row[] }) {
  return (
    <div className="flex flex-col gap-12">
      <table className="hidden w-full tabular-nums sm:table">
        <thead><tr className={RULE}>
          <th className={TH}>Date and time</th><th className={TH}>Movement</th><th className={`${TH} text-right`}>Moisture</th>
          <th className={`${TH} text-right`}>Wet mass after</th><th className={`${TH} pr-0 text-right`}>Dry biochar after</th>
        </tr></thead>
        <tbody>
          {rows.map((row) => row.move.kind === "mode" ? (
            <tr key={row.move.id} className={RULE}><td colSpan={5} className={`py-10 body-caption ${SECONDARY}`}><span className="tabular-nums">{dateTimeLabel(row.move.at)}</span> {row.move.caption}</td></tr>
          ) : (
            <tr key={row.move.id} className={`${RULE} align-top body-small`}>
              <td className={`py-10 pr-12 whitespace-nowrap ${SECONDARY}`}>{dateTimeLabel(row.move.at)}</td>
              <td className="py-10 pr-12"><Sentence row={row} /></td>
              <td className={`py-10 pr-12 text-right ${SECONDARY}`}>{row.move.moisture === null ? "" : formatMoisturePercent(row.move.moisture)}</td>
              <td className="py-10 pr-12 text-right">{row.after?.wet == null ? "" : kg(row.after.wet)}</td>
              <td className="py-10 text-right">{row.after ? kg(row.after.biochar) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="flex flex-col sm:hidden">
        {rows.map((row) => row.move.kind === "mode" ? <li key={row.move.id}><ModeRow move={row.move} /></li> : (
          <li key={row.move.id} className={`${RULE} flex flex-col gap-2 py-12 body-caption tabular-nums`}>
            <span className={MUTED}>{dateTimeLabel(row.move.at)}</span>
            <Sentence row={row} />
            {moisture(row.move) && <span className={SECONDARY}>{moisture(row.move)}</span>}
            {row.after?.wet != null && <span className={SECONDARY}>Wet mass after {kg(row.after.wet)}</span>}
            {row.after && <span className={SECONDARY}>Dry biochar after {kg(row.after.biochar)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small table of the parts of one entry: change and stock after, wet mass as the total underneath. */
function PartsTable({ row }: { row: Row }) {
  const after = row.after as Snapshot;
  const parts = row.parts ?? [];
  return (
    <div className="flex flex-col gap-8">
      <table className="w-full tabular-nums body-caption">
        <thead><tr><th className={TH}>In the bin</th><th className={`${TH} text-right`}>Change</th><th className={`${TH} pr-0 text-right`}>After</th></tr></thead>
        <tbody>
          {parts.map((part: Part) => (
            <tr key={part.label} className={RULE}>
              <td className="py-6 pr-12">{part.label}</td>
              <td className={`py-6 pr-12 text-right ${SECONDARY}`}>{part.delta === null ? "" : signedKg(part.delta)}</td>
              <td className="py-6 text-right">{kg(part.kg)}</td>
            </tr>
          ))}
          {after.wet !== null && row.move.delta.wet !== null && (
            <tr className="font-medium">
              <td className="py-6 pr-12">Wet mass</td>
              <td className="py-6 pr-12 text-right">{signedKg(row.move.delta.wet)}</td>
              <td className="py-6 text-right">{kg(after.wet)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-16 gap-y-2 body-caption">
        {row.move.source && <><dt className={MUTED}>From</dt><dd>{row.move.source}</dd></>}
        {row.move.moisture !== null && <><dt className={MUTED}>Moisture</dt><dd>{formatMoisturePercent(row.move.moisture)}</dd></>}
        <dt className={MUTED}>Recorded by</dt><dd>{row.move.recordedBy}{row.move.recordedAt !== row.move.at && `, ${dateTimeLabel(row.move.recordedAt)}`}</dd>
      </dl>
    </div>
  );
}

/** A2: days as headers carrying the stock at the end of the day; an entry opens into its parts. */
function VariantA2({ rows }: { rows: Row[] }) {
  const days = [...new Set(rows.map((row) => row.move.at.slice(0, 10)))];
  return (
    <div className="flex flex-col gap-12">
      {days.map((day) => {
        const inDay = rows.filter((row) => row.move.at.startsWith(day));
        const end = inDay.find((row) => row.after)?.after;
        return (
          <section key={day} className="flex flex-col">
            <h4 className={`flex flex-col gap-2 border-b border-[var(--clr-dark-purple-40)] pb-6 body-caption sm:flex-row sm:justify-between ${MUTED}`}>
              <span>{dayLabel(day)}</span>
              {end && <span className="tabular-nums">{end.wet === null ? `${kg(end.biochar)} dry biochar at day end` : `${kg(end.wet)} wet mass at day end`}</span>}
            </h4>
            {inDay.map((row) => row.move.kind === "mode" ? <p key={row.move.id} className={`${RULE} py-10 body-caption ${SECONDARY}`}>{timeLabel(row.move.at)} {row.move.caption}</p> : (
              <details key={row.move.id} className={`group ${RULE}`}>
                <summary className="grid cursor-pointer list-none grid-cols-[40px_minmax(0,1fr)_14px] items-start gap-8 py-10 hover:bg-[var(--clr-dark-purple-5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] [&::-webkit-details-marker]:hidden">
                  <span className={`pt-2 body-caption tabular-nums ${MUTED}`}>{timeLabel(row.move.at)}</span>
                  <Sentence row={row} />
                  <CaretDownIcon size={14} aria-hidden="true" className={`mt-4 ${MUTED} transition-transform group-open:rotate-180 motion-reduce:transition-none`} />
                </summary>
                <div className="pb-16 sm:pl-48">
                  {row.after ? <PartsTable row={row} /> : <p className={`body-caption ${SECONDARY}`}>A correction replaced this entry. It no longer counts toward the stock.</p>}
                </div>
              </details>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** A3: what is in the bin now, once, as a table; the history is then plain, dated sentences. */
function VariantA3({ rows }: { rows: Row[] }) {
  const now = nowOf(rows);
  const parts = partsOf(now);
  const total = parts.reduce((sum, part) => sum + part.kg, 0);
  return (
    <div className="flex flex-col gap-24">
      <table className="w-full tabular-nums body-small">
        <thead><tr className={RULE}><th className={TH}>In the bin now</th><th className={`${TH} text-right`}>Mass</th><th className={`${TH} pr-0 text-right`}>Share</th></tr></thead>
        <tbody>
          {parts.map((part) => (
            <tr key={part.label} className={RULE}>
              <td className="py-8 pr-12">{part.label}</td>
              <td className="py-8 pr-12 text-right">{kg(part.kg)}</td>
              <td className={`py-8 text-right ${SECONDARY}`}>{Math.round((part.kg / total) * PERCENT)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col">
        <h4 className={`border-b border-[var(--clr-dark-purple-40)] pb-6 body-caption ${MUTED}`}>Movements</h4>
        {rows.filter((row) => !row.replacedBy).map((row) => row.move.kind === "mode" ? <ModeRow key={row.move.id} move={row.move} /> : (
          <div key={row.move.id} className={`${RULE} flex flex-col gap-2 py-10 sm:flex-row sm:gap-16`}>
            <span className={`body-caption tabular-nums sm:w-[152px] sm:shrink-0 sm:pt-2 ${MUTED}`}>{dateTimeLabel(row.move.at)}</span>
            <span className="flex min-w-0 flex-col gap-2">
              <span className="body-small font-medium">{row.corrected ? `${correctionSentence(row.move)}, was ${kg(Math.abs(row.corrected.delta.wet ?? 0))}` : sentence(row.move)}</span>
              <span className={`body-caption ${SECONDARY}`}>{[moisture(row.move), row.move.source && `${row.move.kind === "added" ? "from" : "for product"} ${row.move.source}`].filter(Boolean).join(", ")}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The modal body in place of the round 1 timeline: headline, then the history in the chosen layout. */
export function BinHistoryRound2({ variant }: { variant: VariantKey }) {
  const state = useProtoState();
  const rows = buildRows(state);
  return (
    <div className="flex flex-col gap-20">
      <Headline now={nowOf(rows)} />
      {variant === "A1" && <VariantA1 rows={rows} />}
      {variant === "A2" && <VariantA2 rows={rows} />}
      {variant === "A3" && <VariantA3 rows={rows} />}
    </div>
  );
}
