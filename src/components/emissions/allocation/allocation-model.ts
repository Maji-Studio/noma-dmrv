/**
 * The allocation view model: who carries each record. Pure, no React. One
 * "owner" is a column of the allocation, either a credit batch, a Removal, or
 * Not yet allocated. The server sends independent batch and Removal parts.
 */
import {
  NOT_YET,
  type AllocationRecord,
  type EmissionAllocation,
  type EmissionAllocationInput,
  type FeedstockUse,
  type GroupKey,
  type PartBasis,
  type Unit,
} from "@/types/emission-allocation";

export const NOT_YET_LABEL = "Not yet allocated";
const PERCENT = 100;
/** Kilograms closer than this count as equal when a delivery is compared with what a page used. */
const KG_TOLERANCE = 0.001;

export type Surface = "batch" | "removal";

export interface Owner {
  key: string;
  label: string;
  /** Second line: the batch month, or the Removal's credit batch codes. */
  sub: string;
  surface?: Surface;
  /** Keys in the corresponding server-owned parts array. */
  members: string[];
  notYet?: boolean;
}

export interface Focus {
  surface: Surface;
  /** The batch or Removal the page is about. */
  owner: Owner;
  /** Every batch or Removal in the response, in time order. */
  owners: Owner[];
  /** The last column: parts nobody carries yet. */
  notYet: Owner;
}

export const GROUP_ORDER: GroupKey[] = ["feedstockTransport", "production", "deliveryTransport", "manual"];

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

function monthOf(date: string): string {
  return monthFormat.format(new Date(`${date}T00:00:00Z`));
}

export const NOT_YET_OWNER: Owner = { key: NOT_YET, label: NOT_YET_LABEL, sub: "Nothing used yet", members: [NOT_YET], notYet: true };

function sortedBatches(allocation: EmissionAllocation) {
  return [...allocation.batches].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.code.localeCompare(b.code));
}

/** One owner per credit batch in the response, in time order. */
export function batchOwners(allocation: EmissionAllocation): Owner[] {
  return sortedBatches(allocation).map((batch) => ({ key: batch.id, label: batch.code, sub: monthOf(batch.startDate), members: [batch.id] }));
}

/** Membership is a caption only; shares come from removalParts. */
export function removalOwners(allocation: EmissionAllocation): Owner[] {
  const codes = new Map(allocation.batches.map((batch) => [batch.id, batch.code]));
  return allocation.removals.map((removal) => ({
    key: removal.id,
    label: removal.code,
    sub: removal.creditBatchIds.map((id) => codes.get(id) ?? id).join(", "),
    members: [removal.id],
    surface: "removal",
  }));
}

/** Removal unassigned shares are explicit in the server response. */
export function removalNotYet(_allocation: EmissionAllocation): Owner {
  return { ...NOT_YET_OWNER, surface: "removal" };
}

/** Build the owners for a surface. Null when the page's own batch or Removal is not in the response. */
export function buildFocus(allocation: EmissionAllocation, input: EmissionAllocationInput): Focus | null {
  if ("creditBatchId" in input) {
    const owners = batchOwners(allocation);
    const owner = owners.find((candidate) => candidate.key === input.creditBatchId);
    return owner ? { surface: "batch", owner, owners, notYet: NOT_YET_OWNER } : null;
  }
  const owners = removalOwners(allocation);
  const owner = owners.find((candidate) => candidate.key === input.removalId);
  return owner ? { surface: "removal", owner, owners, notYet: removalNotYet(allocation) } : null;
}

/** Every column of the allocation, Not yet allocated last. */
export function allOwners(focus: Focus): Owner[] {
  return [...focus.owners, focus.notYet];
}

/** The share of a record one owner carries (0 to 1). */
export function fractionFor(record: AllocationRecord, owner: Owner): number {
  return (owner.surface === "removal" ? record.removalParts : record.parts).filter((part) => owner.members.includes(part.key)).reduce((sum, part) => sum + part.fraction, 0);
}

export function basisFor(record: AllocationRecord, owner: Owner): PartBasis[] {
  return (owner.surface === "removal" ? record.removalParts : record.parts).filter((part) => owner.members.includes(part.key)).flatMap((part) => part.basis);
}

/** Whole percents that always add to 100 (largest remainder), so a row never reads 99% or 101%. */
export function wholePercents(fractions: number[]): number[] {
  const raw = fractions.map((fraction) => fraction * PERCENT);
  const floors = raw.map(Math.floor);
  let left = PERCENT - floors.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

export interface Share {
  owner: Owner;
  fraction: number;
  percent: number;
}

/** Owners with a positive share of this record, in column order, Not yet allocated last. */
export function sharesOf(record: AllocationRecord, owners: Owner[]): Share[] {
  const all = owners.map((owner) => ({ owner, fraction: fractionFor(record, owner) })).filter((share) => share.fraction > 0);
  const percents = wholePercents(all.map((share) => share.fraction));
  return all.map((share, index) => ({ ...share, percent: percents[index] }));
}

/** The one percent shown for an owner's share of a record, matching the record's row. */
export function percentFor(record: AllocationRecord, owner: Owner, owners: Owner[]): number {
  return sharesOf(record, owners).find((share) => share.owner.key === owner.key)?.percent ?? 0;
}

export function recordsOf(records: AllocationRecord[], group: GroupKey): AllocationRecord[] {
  return records.filter((record) => record.group === group);
}

// ---------------------------------------------------------------------------
// Quantities: one figure per unit, unknown stays unknown
// ---------------------------------------------------------------------------

export interface Amount {
  unit: Unit;
  /** Null when no reading of this unit was recorded. */
  value: number | null;
}

function addAmount(byUnit: Map<Unit, number | null>, unit: Unit, value: number | null) {
  const previous = byUnit.get(unit);
  if (value === null) {
    if (previous === undefined) byUnit.set(unit, null);
    return;
  }
  byUnit.set(unit, (previous ?? 0) + value);
}

/** Sum a record's quantities per unit. A unit with no recorded reading stays null, never zero. */
export function amountsOf(record: AllocationRecord, fraction = 1): Amount[] {
  const byUnit = new Map<Unit, number | null>();
  for (const quantity of record.quantities) {
    addAmount(byUnit, quantity.unit, quantity.value === null ? null : quantity.value * fraction);
  }
  return [...byUnit.entries()].map(([unit, value]) => ({ unit, value }));
}

/** Totals per unit across records, each record scaled by the owner's share (or whole when no owner). */
export function totalAmounts(records: AllocationRecord[], owner?: Owner): Amount[] {
  const byUnit = new Map<Unit, number | null>();
  for (const record of records) {
    const fraction = owner ? fractionFor(record, owner) : 1;
    if (fraction <= 0) continue;
    for (const amount of amountsOf(record, fraction)) {
      addAmount(byUnit, amount.unit, amount.value);
    }
  }
  return [...byUnit.entries()].map(([unit, value]) => ({ unit, value }));
}

// ---------------------------------------------------------------------------
// Feedstock hints: why a page carries a whole delivery, or none of one it drew from
// ---------------------------------------------------------------------------

export type FeedstockHint =
  /** Carries the whole leg, but its runs drew only part of the delivery. */
  | { kind: "partly"; record: AllocationRecord; use: FeedstockUse; usedKg: number; ownerLabel: string }
  /** Receiving side: its runs drew from the delivery, another batch carries it. */
  | { kind: "countedOn"; record: AllocationRecord; use: FeedstockUse; usedKg: number; ownerLabel: string };

export function usedBy(use: FeedstockUse, owner: Owner): number {
  return use.used.filter((entry) => owner.members.includes(entry.creditBatchId)).reduce((sum, entry) => sum + entry.kg, 0);
}

/** The label of whoever carries a delivery: the Removal or batch column (of `labelOwners`) that holds it. */
export function carrierLabel(batchId: string, labelOwners: Owner[], batchCodes: ReadonlyMap<string, string>): string {
  return labelOwners.find((owner) => owner.members.includes(batchId))?.label ?? batchCodes.get(batchId) ?? batchId;
}

export function batchCodesOf(allocation: EmissionAllocation): Map<string, string> {
  return new Map(allocation.batches.map((batch) => [batch.id, batch.code]));
}

/** Hint A for one delivery seen from one owner, or null when nothing needs saying. */
export function feedstockHint(record: AllocationRecord, owner: Owner, labelOwners: Owner[], batchCodes: ReadonlyMap<string, string>): FeedstockHint | null {
  const use = record.feedstock;
  if (!use || owner.surface === "removal" || owner.notYet || !use.owner) return null;
  const usedKg = usedBy(use, owner);
  const ownerLabel = carrierLabel(use.owner, labelOwners, batchCodes);
  if (!owner.members.includes(use.owner)) return usedKg > 0 ? { kind: "countedOn", record, use, usedKg, ownerLabel } : null;
  if (usedKg >= use.wetKg - KG_TOLERANCE) return null;
  return { kind: "partly", record, use, usedKg, ownerLabel };
}
