/** Display helpers for the allocation: figures, days and the one-line description of each record. */
import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDayString, formatDistanceKm, formatMassKg } from "@/lib/format-utils";
import { MASS_KG_FORMAT_OPTIONS } from "@/lib/mass-precision";
import type { AllocationRecord, Unit } from "@/types/emission-allocation";
import type { Amount } from "./allocation-model";

const AMOUNT_FRACTION_DIGITS = 1;
const amountFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: AMOUNT_FRACTION_DIGITS });

/** Saved masses at their stored precision, through the shared formatter. */
export function formatKg(kg: number | null): string {
  return formatMassKg(kg, { digits: MASS_KG_STORAGE_DECIMALS });
}

/** A saved mass without its unit ("2,000"), at the same precision and locale as `formatKg`. */
export function formatKgNumber(kg: number): string {
  return kg.toLocaleString(undefined, { ...MASS_KG_FORMAT_OPTIONS, maximumFractionDigits: MASS_KG_STORAGE_DECIMALS });
}

/** The number without its unit, for a table column that names the unit in its head. */
export function formatNumber(value: number): string {
  return amountFormat.format(value);
}

/** "1,257 t·km", or "Not recorded" with no unit when the reading is missing. */
export function formatValue(value: number | null, unit: Unit): string {
  return value === null ? MISSING_VALUE.notRecorded : `${amountFormat.format(value)} ${unit}`;
}

/** Several figures on one line. Derived figures (shares, totals) leave a unit out when nothing was recorded. */
export function formatAmounts(amounts: Amount[], derived = false): string {
  return amounts
    .filter((amount) => !derived || amount.value !== null)
    .map((amount) => formatValue(amount.value, amount.unit))
    .join(", ");
}

export function formatDay(date: string): string {
  return formatDayString(date);
}

/** What a manual entry is called: its component name. Every other record keeps its code. */
export function recordName(record: AllocationRecord): string {
  return record.detail.kind === "manual" ? record.detail.componentName : record.code;
}

/** Short facts about a record, for the line under its name: "North bay", "10,000 kg wet", "42 km". */
export function recordFacts(record: AllocationRecord): string[] {
  const { detail } = record;
  if (detail.kind === "feedstockTransport") {
    const km = detail.legs.length === 1 ? [formatDistanceKm(detail.legs[0].oneWayKm)] : detail.legs.length > 1 ? [`${detail.legs.length} legs`] : [];
    return [detail.binName, `${formatKg(detail.wetKg)} wet`, ...km];
  }
  if (detail.kind === "production") return detail.reactorCode ? [detail.reactorCode] : ["Production run"];
  if (detail.kind === "deliveryTransport") {
    const facts = [detail.wetKg === null ? null : `${formatKg(detail.wetKg)} wet`, detail.oneWayKm === null ? null : formatDistanceKm(detail.oneWayKm)];
    return facts.some(Boolean) ? facts.filter((fact): fact is string => fact !== null) : ["Biochar delivery"];
  }
  return ["Manual entry"];
}

export function recordLine(record: AllocationRecord): string {
  return `${formatDay(record.date)}, ${recordFacts(record).join(", ")}`;
}
