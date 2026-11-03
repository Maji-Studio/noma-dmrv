/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). Round 3:
 * the two hints Kenji asked for under the kept rule (a delivery's whole
 * transport on the batch that drew first).
 *   (a) partly: this page carries a whole delivery its runs only partly used.
 *   (b) noRun: this page carries a delivery no run used, because mass left
 *       the bin in its production period.
 * Plus the receiving side: its runs drew from a delivery counted elsewhere.
 * Two treatments, `?hint=a|b`: A marks each affected row and explains it
 * behind an (i); B puts one summary notice at the top of Allocation that
 * names the deliveries and jumps to their rows.
 */
"use client";

import type { ReactNode } from "react";
import { CircleDashedIcon, CircleHalfIcon } from "@phosphor-icons/react/dist/ssr";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { Notice } from "@/components/ui/notice";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { cn } from "@/lib/utils";
import {
  BATCHES,
  OUT_WORDS,
  feedstockHints,
  formatDay,
  formatKg,
  formatValue,
  type FeedstockHint,
  type Focus,
  type RestPart,
} from "./fixture";
import { MUTED, groupMeta } from "./parts";

export type HintMode = "a" | "b";

export const HINT_MODES: { value: HintMode; label: string }[] = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
];

const ICON_PX = 14;

// ---------------------------------------------------------------------------
// Copy, from the operator's own numbers
// ---------------------------------------------------------------------------

function restPhrase(part: RestPart): string {
  if (part.kind === "batch") return `${part.batch} used ${formatKg(part.kg)}`;
  if (part.kind === "still") return `${formatKg(part.kg)} is still in ${part.bin}`;
  return `${formatKg(part.out.kg)} ${OUT_WORDS[part.out.kind]} on ${formatDay(part.out.date)}`;
}

function periodOf(code: string): string {
  const batch = BATCHES.find((candidate) => candidate.code === code);
  return batch ? `${formatDay(batch.startDate)} to ${formatDay(batch.endDate)}` : "";
}

const CODE_PATTERN = /((?:CB|RM|FS|PR)-\d{2}-\d{3})/;

/** Keeps record codes whole when a line wraps ("CB-26-001", never "CB-" and "26-001"). */
function keepCodes(text: string): ReactNode {
  return text.split(CODE_PATTERN).map((part, index) => (index % 2 ? <span key={index} className="whitespace-nowrap">{part}</span> : part));
}

/** The short marker on a row (treatment A). */
export function markerText(hint: FeedstockHint): string {
  if (hint.kind === "noRun") return `No run. ${formatKg(hint.out.kg)} ${OUT_WORDS[hint.out.kind]} on ${formatDay(hint.out.date)}`;
  return `Used ${formatKg(hint.usedKg).replace(" kg", "")} of ${formatKg(hint.use.wetKg)}`;
}

/** One line in the summary notice (treatment B). */
function noticeLine(hint: FeedstockHint): string {
  if (hint.kind === "countedOn") return `Used ${formatKg(hint.usedKg)}. Counted on ${hint.countedOn}.`;
  if (hint.kind === "noRun") return `No run used it. ${formatKg(hint.out.kg)} ${OUT_WORDS[hint.out.kind]} on ${formatDay(hint.out.date)}, in ${hint.use.owner}'s period.`;
  const rest = hint.rest.map(restPhrase).join(", ");
  return `Used ${formatKg(hint.usedKg).replace(" kg", "")} of ${formatKg(hint.use.wetKg)}. ${rest.charAt(0).toUpperCase()}${rest.slice(1)}.`;
}

/** The (i) sentence: who carries the whole leg and why. */
function whySentence(hint: FeedstockHint, focus: Focus): string {
  const { use, record } = hint;
  const whole = formatValue(use.tonneKm, "t·km");
  if (hint.kind === "noRun") {
    const out = hint.out;
    return `No production run has drawn from ${record.code}. ${formatKg(out.kg)} was ${OUT_WORDS[out.kind]} on ${formatDay(out.date)}, inside ${use.owner}'s production period (${periodOf(use.owner ?? "")}), so ${use.owner} carries the whole ${whole}.`;
  }
  const first = use.firstRun!;
  const lead = `${first.batch} carries the whole ${whole} because its run ${first.code} drew from ${record.code} first, on ${formatDay(first.date)}.`;
  if (hint.kind === "partly") return `${lead} What other credit batches drew later, and what is still in the bin, is counted on ${first.batch} too.`;
  const mine = use.used.filter((entry) => focus.owner.batches.includes(entry.batch)).map((entry) => entry.batch).join(" and ");
  return `${lead} The ${formatKg(hint.usedKg)} ${mine} drew is counted on ${first.batch}, so ${focus.owner.label} carries none of it.`;
}

// ---------------------------------------------------------------------------
// Treatment A: a marker on the row, the explanation behind its (i)
// ---------------------------------------------------------------------------

function WhereItWent({ hint }: { hint: FeedstockHint }) {
  const { use, record } = hint;
  const rows: { key: string; name: string; sub?: string; kg: number }[] = [
    ...use.used.map((entry) => ({
      key: entry.batch,
      name: entry.batch,
      sub: entry.batch === use.owner ? `${entry.runs.join(", ")}. Carries it` : entry.runs.join(", "),
      kg: entry.kg,
    })),
    ...use.out.map((out) => ({
      key: `out-${out.date}`,
      name: `${OUT_WORDS[out.kind].charAt(0).toUpperCase()}${OUT_WORDS[out.kind].slice(1)} on ${formatDay(out.date)}`,
      sub: out.kind === "lost" && use.reason === "leftInPeriod" ? `In ${use.owner}'s period. Carries it` : undefined,
      kg: out.kg,
    })),
    ...(use.stillKg > 0 ? [{ key: "still", name: `Still in ${use.bin}`, kg: use.stillKg }] : []),
  ];
  return (
    <table className="w-full border-collapse">
      <caption className={cn("pb-6 text-left body-caption font-medium", MUTED)}>Where the {formatKg(use.wetKg)} went</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="[border-top:var(--row-divider)] align-top">
            <th scope="row" className="py-6 pr-12 text-left font-normal">
              <span className="block body-small">{row.name}</span>
              {row.sub && <span className={cn("block body-caption", MUTED)}>{row.sub}</span>}
            </th>
            <td className="py-6 text-right body-small tabular-nums">{formatKg(row.kg)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="[border-top:var(--hair-2)]">
          <th scope="row" className="py-6 pr-12 text-left body-small font-medium">{record.code}, {formatDay(record.date)}</th>
          <td className="py-6 text-right body-small font-medium tabular-nums">{formatKg(use.wetKg)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

export function HintExplanation({ hint, focus, className }: { hint: FeedstockHint; focus: Focus; className?: string }) {
  return (
    <ExplanationInfo title={`${hint.record.code} transport`} hint={keepCodes(whySentence(hint, focus))} className={className}>
      <WhereItWent hint={hint} />
    </ExplanationInfo>
  );
}

/** "◐ Used 8,000 of 10,000 kg (i)": the row marker of treatment A. Inline, so it wraps as text in a narrow column. */
export function HintMarker({ hint, focus, className }: { hint: FeedstockHint; focus: Focus; className?: string }) {
  const Icon = hint.kind === "noRun" ? CircleDashedIcon : CircleHalfIcon;
  return (
    <span className={cn("block body-caption text-[var(--color-text-primary)]", className)}>
      <Icon size={ICON_PX} aria-hidden className="mr-4 inline-block align-[-2px] text-[var(--clr-dark-purple-60)]" />
      {markerText(hint)}
      <HintExplanation hint={hint} focus={focus} className="-my-6 ml-2" />
    </span>
  );
}

/** The receiving side, in this page's own share cell: "Counted on CB-26-001". */
export function CountedOnNote({ hint }: { hint: FeedstockHint }) {
  if (hint.kind !== "countedOn") return null;
  return (
    <span className={cn("flex flex-wrap justify-end gap-x-4 body-caption", MUTED)}>
      <span className="whitespace-nowrap">Counted on</span>
      <span className="whitespace-nowrap font-mono text-[var(--color-text-primary)]">{hint.countedOn}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Treatment B: one summary notice at the top of Allocation
// ---------------------------------------------------------------------------

function HintList({ hints, onJump }: { hints: FeedstockHint[]; onJump: (recordId: string) => void }) {
  return (
    <ul className="grid grid-cols-[auto_1fr] gap-x-12 gap-y-6">
      {hints.map((hint) => (
        <li key={hint.record.id} className="col-span-2 grid grid-cols-subgrid items-baseline">
          <button
            type="button"
            onClick={() => onJump(hint.record.id)}
            aria-label={`Show ${hint.record.code}`}
            className={cn(RECORD_CODE_LINK, INLINE_HIT_AREA, "body-small")}
          >
            {hint.record.code}
          </button>
          <span className="body-small text-[var(--color-text-secondary)]">{keepCodes(noticeLine(hint))}</span>
        </li>
      ))}
    </ul>
  );
}

export function HintNotice({ focus, onJump }: { focus: Focus; onJump: (recordId: string) => void }) {
  const hints = feedstockHints(focus.owner);
  if (!hints.length) return null;
  const carried = hints.filter((hint) => hint.kind !== "countedOn");
  const counted = hints.filter((hint) => hint.kind === "countedOn");
  const rule = groupMeta("feedstockTransport");
  const title = carried.length
    ? `${focus.owner.label} carries ${carried.length} feedstock ${carried.length === 1 ? "delivery" : "deliveries"} in full`
    : "Feedstock counted on another credit batch";
  return (
    <Notice
      tone="info"
      boxed
      live={false}
      title={
        <span>
          {keepCodes(title)}
          <ExplanationInfo title={rule.title} hint={rule.rule} className="-my-6 ml-4" />
        </span>
      }
    >
      <div className="flex flex-col gap-12 pt-8">
        {carried.length > 0 && <HintList hints={carried} onJump={onJump} />}
        {carried.length > 0 && counted.length > 0 && (
          <p className="body-small font-medium text-[var(--color-text-primary)]">Counted on another credit batch</p>
        )}
        {counted.length > 0 && <HintList hints={counted} onJump={onJump} />}
      </div>
    </Notice>
  );
}

/** Scroll a table row (or the flow's detail row) into view and focus it. */
export function jumpToRow(recordId: string) {
  const targets = [...document.querySelectorAll<HTMLElement>(`[data-record-row="${recordId}"]`)];
  const visible = targets.find((element) => element.offsetParent !== null);
  if (!visible) return;
  visible.scrollIntoView({ block: "center", behavior: "smooth" });
  visible.focus({ preventScroll: true });
}
