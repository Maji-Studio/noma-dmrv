/** Display helpers for the allocation: figures, days and the one-line description of each record. */
import { MISSING_VALUE } from "@/lib/copy-utils";
import type { AllocationRecord, Unit } from "@/types/emission-allocation";
import type { Amount } from "./allocation-model";

const kgFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const amountFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function formatKg(kg: number | null): string {
  return kg === null ? MISSING_VALUE.notRecorded : `${kgFormat.format(kg)} kg`;
}

/** The number without its unit, for a table column that names the unit in its head. */
export function formatNumber(value: number | null): string {
  return value === null ? MISSING_VALUE.notRecorded : amountFormat.format(value);
}

/** "1,257 t·km", or "Not recorded" with no unit when the reading is missing. */
export function formatValue(value: number | null, unit: Unit): string {
  return value === null ? MISSING_VALUE.notRecorded : `${amountFormat.format(value)} ${unit}`;
}

export function formatAmounts(amounts: Amount[]): string {
  return amounts.map((amount) => formatValue(amount.value, amount.unit)).join(", ");
}

export function formatDay(date: string): string {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

/** What a manual entry is called: its component name. Every other record keeps its code. */
export function recordName(record: AllocationRecord): string {
  return record.detail.kind === "manual" ? record.detail.componentName : record.code;
}

/** Short facts about a record, for the line under its name: "North bay", "10,000 kg wet", "42 km". */
export function recordFacts(record: AllocationRecord): string[] {
  const { detail } = record;
  if (detail.kind === "feedstockTransport") {
    const km = detail.legs.length === 1 ? [`${amountFormat.format(detail.legs[0].oneWayKm)} km`] : detail.legs.length > 1 ? [`${detail.legs.length} legs`] : [];
    return [detail.binName, `${formatKg(detail.wetKg)} wet`, ...km];
  }
  if (detail.kind === "production") return detail.reactorCode ? [detail.reactorCode] : ["Production run"];
  if (detail.kind === "deliveryTransport") {
    const facts = [detail.wetKg === null ? null : `${formatKg(detail.wetKg)} wet`, detail.oneWayKm === null ? null : `${amountFormat.format(detail.oneWayKm)} km`];
    return facts.some(Boolean) ? facts.filter((fact): fact is string => fact !== null) : ["Biochar delivery"];
  }
  return ["Manual entry"];
}

export function recordLine(record: AllocationRecord): string {
  return `${formatDay(record.date)}, ${recordFacts(record).join(", ")}`;
}
