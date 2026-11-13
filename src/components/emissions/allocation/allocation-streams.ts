/**
 * The quantities the Allocation Flow view shows, one row each: Feedstock
 * transport, Biochar delivery transport, Diesel, Electricity and, when an
 * entry has it, Manual transport. A stream says which of a record's figures
 * belongs to it and in what unit; the rows are built in `allocation-share-summary`.
 */
import type { AllocationRecord, Unit } from "@/types/emission-allocation";
import { amountsOf } from "./allocation-model";

export type StreamKey = "feedstock" | "delivery" | "diesel" | "electricity" | "manual";

export interface Stream {
  key: StreamKey;
  /** The row's name, in full. */
  label: string;
  /** What the figures are, for a sentence: "transport", "diesel". */
  noun: string;
  /** What fills an empty row: the next step for the operator. */
  emptyHint: string;
  unit: Unit;
  /** The record's figure in this stream, or null when it has none recorded. */
  pick: (record: AllocationRecord) => number | null;
  /** Whether the record belongs in this stream at all, recorded or not. */
  has: (record: AllocationRecord) => boolean;
}

const unitAmount = (record: AllocationRecord, unit: Unit) => amountsOf(record).find((amount) => amount.unit === unit)?.value ?? null;
const hasUnit = (record: AllocationRecord, unit: Unit) => record.quantities.some((quantity) => quantity.unit === unit);
const inGroupWithUnit = (group: AllocationRecord["group"], unit: Unit) => (record: AllocationRecord) => record.group === group && hasUnit(record, unit);

export const STREAMS: Stream[] = [
  { key: "feedstock", label: "Feedstock transport", noun: "transport", emptyHint: "Shows once a feedstock delivery has its distance and load recorded.", unit: "t·km", pick: (r) => (r.group === "feedstockTransport" ? unitAmount(r, "t·km") : null), has: (r) => r.group === "feedstockTransport" },
  { key: "delivery", label: "Biochar delivery transport", noun: "transport", emptyHint: "Shows once a biochar delivery has its distance and mass recorded.", unit: "t·km", pick: (r) => (r.group === "deliveryTransport" ? unitAmount(r, "t·km") : null), has: (r) => r.group === "deliveryTransport" },
  { key: "diesel", label: "Diesel", noun: "diesel", emptyHint: "Shows once a production run or a manual entry records it.", unit: "L", pick: (r) => unitAmount(r, "L"), has: (r) => hasUnit(r, "L") },
  { key: "electricity", label: "Electricity", noun: "electricity", emptyHint: "Shows once a production run or a manual entry records it.", unit: "kWh", pick: (r) => unitAmount(r, "kWh"), has: (r) => hasUnit(r, "kWh") },
  { key: "manual", label: "Manual transport", noun: "transport", emptyHint: "Shows once a manual entry records t·km.", unit: "t·km", pick: (r) => (r.group === "manual" ? unitAmount(r, "t·km") : null), has: inGroupWithUnit("manual", "t·km") },
];

/** Streams worth a row: the four standing ones, and manual transport only when an entry has it. */
export function visibleStreams(records: AllocationRecord[]): Stream[] {
  return STREAMS.filter((stream) => stream.key !== "manual" || records.some(stream.has));
}
