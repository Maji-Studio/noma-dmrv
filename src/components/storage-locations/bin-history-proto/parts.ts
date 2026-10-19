/**
 * PROTOTYPE (issue #1004, round 2, throwaway, never merges): fixture movements
 * for one product bin and the figures every variant derives from them.
 * Nothing here is read from the database.
 *
 * Wet mass is the headline; dry biochar sits beside it when known; every other
 * figure lives in the history. Switch with `?variant=A1|A2|A3`; add
 * `&state=nomoisture` for a bin whose last batch has no moisture reading.
 */
import { ESTIMATED_WATER_LABEL } from "@/lib/output-stock/labels";

export const DRY_BIOCHAR = "Dry biochar";
export const INGREDIENTS = ["Compost", "Wood ash"] as const;
const EPSILON_KG = 1e-6;

export type MoveKind = "added" | "withdrawal" | "mode";

/** Signed change of one movement. Wet is null when the batch has no moisture reading. */
export interface Delta { wet: number | null; biochar: number; ingredients: number[] }

export interface Move {
  id: string;
  kind: MoveKind;
  /** Local facility time, "YYYY-MM-DDTHH:mm". */
  at: string;
  /** Source batch or product the movement came from or went to. */
  source?: string;
  delta: Delta;
  moisture: number | null;
  recordedAt: string;
  recordedBy: string;
  /** A correction names the entry it replaced. */
  corrects?: string;
  /** Mode change text. */
  caption?: string;
}

export interface Snapshot { wet: number | null; biochar: number; ingredients: number[] }

export interface Part { label: string; kg: number; delta: number | null }

const NO_INGREDIENTS = [0, 0];
const d = (wet: number | null, biochar: number, compost = 0, ash = 0): Delta => ({ wet, biochar, ingredients: [compost, ash] });

const BASE_MOVES: Move[] = [
  { id: "e1", kind: "added", at: "2026-10-14T09:10", source: "PRD-021", delta: d(300, 246), moisture: 18, recordedAt: "2026-10-14T09:10", recordedBy: "Operator" },
  { id: "e2", kind: "added", at: "2026-10-14T15:40", source: "PRD-022", delta: d(500, 240, 150), moisture: 22, recordedAt: "2026-10-14T15:40", recordedBy: "Operator" },
  { id: "e3", kind: "added", at: "2026-10-15T11:05", source: "PRD-023", delta: d(400, 200, 80, 40), moisture: 20, recordedAt: "2026-10-15T11:05", recordedBy: "Operator" },
  { id: "m1", kind: "mode", at: "2026-10-15T11:30", delta: d(0, 0), moisture: null, recordedAt: "2026-10-15T11:30", recordedBy: "Operator", caption: "Switched to mix. From here on the bin is one blended pile." },
  { id: "e4", kind: "withdrawal", at: "2026-10-16T14:20", source: "PRD-088", delta: d(-300, -146, -80, -10), moisture: 21, recordedAt: "2026-10-16T14:20", recordedBy: "Operator" },
  { id: "e5", kind: "withdrawal", at: "2026-10-16T14:20", source: "PRD-088", delta: d(-250, -122, -67, -8), moisture: 21, recordedAt: "2026-10-16T16:05", recordedBy: "Operator", corrects: "e4" },
  { id: "e6", kind: "withdrawal", at: "2026-10-17T08:30", source: "PRD-090", delta: d(-150, -70, -22, -3), moisture: 24, recordedAt: "2026-10-17T08:30", recordedBy: "Operator" },
  { id: "e7", kind: "added", at: "2026-10-17T10:15", source: "BC-0431", delta: d(300, 243), moisture: 19, recordedAt: "2026-10-17T10:15", recordedBy: "Operator" },
];

/** A batch added by dry weight alone: no moisture reading, so no wet mass. */
const NO_MOISTURE_MOVE: Move = { id: "e8", kind: "added", at: "2026-10-17T11:40", source: "BC-0432", delta: d(null, 120), moisture: null, recordedAt: "2026-10-17T11:40", recordedBy: "Operator" };

export type ProtoState = "full" | "nomoisture";

export interface Row {
  move: Move;
  /** A corrected entry no longer counts. */
  replacedBy?: Move;
  /** The entry a correction replaced. */
  corrected?: Move;
  /** Stock after this entry, null for an entry that no longer counts. */
  after: Snapshot | null;
  parts: Part[] | null;
}

/** Stock after each entry in time order, skipping entries a correction replaced. Newest first. */
export function buildRows(state: ProtoState): Row[] {
  const moves = state === "nomoisture" ? [...BASE_MOVES, NO_MOISTURE_MOVE] : BASE_MOVES;
  const replaced = new Map(moves.filter((move) => move.corrects).map((move) => [move.corrects as string, move]));
  let run: Snapshot = { wet: 0, biochar: 0, ingredients: NO_INGREDIENTS };
  const rows: Row[] = [];
  const ordered = [...moves].sort((a, b) => a.at.localeCompare(b.at) || a.recordedAt.localeCompare(b.recordedAt));
  for (const move of ordered) {
    const dead = replaced.has(move.id);
    const before = run;
    if (!dead) {
      run = {
        wet: before.wet === null || move.delta.wet === null ? null : before.wet + move.delta.wet,
        biochar: before.biochar + move.delta.biochar,
        ingredients: before.ingredients.map((kg, index) => kg + move.delta.ingredients[index]),
      };
    }
    const after = dead ? null : run;
    rows.push({
      move,
      replacedBy: replaced.get(move.id),
      corrected: move.corrects ? moves.find((item) => item.id === move.corrects) : undefined,
      after,
      parts: after ? partsOf(after, before, move.delta) : null,
    });
  }
  return rows.reverse();
}

export function solids(snapshot: Snapshot): number {
  return snapshot.biochar + snapshot.ingredients.reduce((total, kg) => total + kg, 0);
}

/** Water is wet stock less solids; with no wet figure, or less wet than solids, there is no honest figure to show. */
export function waterOf(snapshot: Snapshot): number | null {
  if (snapshot.wet === null || snapshot.wet < solids(snapshot) - EPSILON_KG) return null;
  return snapshot.wet - solids(snapshot);
}

/** Parts in the order the bin draws them, top down. The water row is left out when it has no honest figure. */
export function partsOf(after: Snapshot, before?: Snapshot, delta?: Delta): Part[] {
  const waterAfter = waterOf(after);
  const waterBefore = before ? waterOf(before) : null;
  const waterDelta = waterAfter !== null && waterBefore !== null ? waterAfter - waterBefore : null;
  return [
    { label: DRY_BIOCHAR, kg: after.biochar, delta: delta ? delta.biochar : null },
    ...INGREDIENTS.map((name, index) => ({ label: `${name} solids`, kg: after.ingredients[index], delta: delta ? delta.ingredients[index] : null })),
    ...(waterAfter === null ? [] : [{ label: ESTIMATED_WATER_LABEL, kg: waterAfter, delta: waterDelta }]),
  ].filter((part) => (delta ? (part.delta ?? 1) !== 0 : part.kg > 0));
}

export function nowOf(rows: Row[]): Snapshot {
  return rows.find((row) => row.after)?.after as Snapshot;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 16, 2026" */
export function dayLabel(at: string): string {
  const [year, month, day] = at.slice(0, 10).split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** "Oct 16, 2026, 14:20" */
export function dateTimeLabel(at: string): string {
  return `${dayLabel(at)}, ${at.slice(11, 16)}`;
}

export function timeLabel(at: string): string {
  return at.slice(11, 16);
}

export function kg(value: number): string {
  return `${(Math.round(value * 10) / 10).toLocaleString("en-US")} kg`;
}

/** Signed change, with a real minus sign. */
export function signedKg(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0 kg";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toLocaleString("en-US")} kg`;
}

/** The sentence a movement reads as: "Added 300 kg wet mass". */
export function sentence(move: Move): string {
  if (move.kind === "mode") return move.caption ?? "";
  const verb = move.kind === "added" ? "Added" : "Withdrew";
  const amount = move.delta.wet === null ? `${kg(Math.abs(move.delta.biochar))} dry biochar` : `${kg(Math.abs(move.delta.wet))} wet mass`;
  return `${verb} ${amount}`;
}

/** "Corrected withdrawal: 250 kg wet mass". */
export function correctionSentence(move: Move): string {
  const amount = move.delta.wet === null ? `${kg(Math.abs(move.delta.biochar))} dry biochar` : `${kg(Math.abs(move.delta.wet))} wet mass`;
  return `Corrected ${move.kind === "added" ? "addition" : "withdrawal"}: ${amount}`;
}

export const NO_MOISTURE_REASON = "The last batch added has no moisture reading, so there is no wet mass. Record one when adding stock.";
