"use client";

import { orderSubBins, planSubBinRows, subBinSources } from "@/lib/output-stock/sub-bin-draw";
import type { OutputStockPreviewInput, OutputSubBin } from "@/types/output-stock";
import { useState } from "react";
import { useOutputSubBins } from "./use-output-stock";

interface SubBinDrawOptions {
  bin: { storageLocationId: string; facilityId: string } | null;
  occurredAt: string | null | undefined;
  wetKg: number | null | undefined;
  /** A correction reads the sub-bins as they were before the entry, and starts from its saved order and readings. */
  correction?: { movementId: string; kind: OutputStockPreviewInput["kind"]; sources?: { layerId: string; moisturePercent: number }[] };
}

/** The operator's choices, kept per bin so another bin starts from oldest first. */
interface DrawChoices {
  binId: string | null;
  /** Null drains oldest first; otherwise the ticked sub-bins in the order they were emptied. */
  order: string[] | null;
  /** Each reading as typed, so a half-typed "3." stays in the input. */
  readings: Record<string, string>;
}

function parseReading(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * A split-bin draw as the form edits it: which sub-bins, in what order, and
 * one reading per sub-bin the load reaches. `sources` is what the preview and
 * the save take; it stays null until every reached sub-bin has a reading.
 * `active` is false for a mix bin, a bin with nothing in it at that time, or
 * a draw the form does not split, and the form then keeps its single moisture
 * field. `pending` covers the first load, so neither field flashes.
 */
export function useSubBinDraw({ bin, occurredAt, wetKg, correction }: SubBinDrawOptions) {
  const validTime = typeof occurredAt === "string" && !Number.isNaN(Date.parse(occurredAt)) ? new Date(occurredAt).toISOString() : null;
  const enabled = bin !== null && validTime !== null;
  const query = useOutputSubBins(bin && validTime ? {
    ...bin, occurredAt: validTime,
    ...(correction ? { correctsMovementId: correction.movementId, kind: correction.kind } : {}),
  } : null);
  const saved = correction?.sources?.length ? correction.sources : null;
  const binId = bin?.storageLocationId ?? null;
  const [stored, setStored] = useState<DrawChoices>(() => ({
    binId,
    order: saved ? saved.map(s => s.layerId) : null,
    readings: Object.fromEntries((saved ?? []).map(s => [s.layerId, String(s.moisturePercent)])),
  }));
  const choices: DrawChoices = stored.binId === binId ? stored : { binId, order: null, readings: {} };
  const subBins: OutputSubBin[] = query.data?.stockMode === "split" ? query.data.subBins : [];
  const active = subBins.length > 0;
  const ordered = orderSubBins(subBins, choices.order);
  const readings = Object.fromEntries(Object.entries(choices.readings).map(([id, raw]) => [id, parseReading(raw)]));
  const plan = planSubBinRows(ordered.map(s => ({ layerId: s.layerId, solidsKg: s.solidsKg, estimatedMoisturePercent: s.moisturePercent })), readings, wetKg);
  // Only an order the operator chose can name a sub-bin the load never
  // reaches; oldest first simply stops where the load does.
  const untickCode = choices.order && plan.complete ? ordered.find(s => s.layerId === plan.unreached[0])?.code ?? null : null;
  // A chosen order the load outgrows while other sub-bins sit unticked needs
  // another tick, not a count: the bin holds more than the ticks do.
  const needsTick = Boolean(choices.order && plan.complete && plan.shortfallWetKg > 0 && subBins.some(s => !choices.order!.includes(s.layerId)));
  const sources = active && !untickCode && !needsTick ? subBinSources(plan, readings) : null;
  const pending = enabled && query.data === undefined && !query.error;
  return {
    query,
    active,
    /** Still finding out whether the bin splits; the form shows neither kind of moisture field yet. */
    pending,
    /**
     * The bin does not split this draw, so the form's single moisture field
     * applies. False while the sub-bins load or after they fail to, so a split
     * bin is never drawn at one reading by accident.
     */
    usesSingleMoisture: !active && !pending && !query.error,
    subBins,
    ordered,
    plan,
    order: choices.order,
    readings: choices.readings,
    sources,
    untickCode,
    needsTick,
    setOrder: (order: string[] | null) => setStored({ ...choices, order }),
    setReading: (layerId: string, raw: string) => setStored({ ...choices, readings: { ...choices.readings, [layerId]: raw } }),
  };
}

export type SubBinDraw = ReturnType<typeof useSubBinDraw>;
