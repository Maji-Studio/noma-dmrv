const MASS_PRECISION = 1_000;
const round = (kg: number) => Math.round(kg * MASS_PRECISION) / MASS_PRECISION;

type Batch = { id: string; wetKg: number; dryKg: number | null };
type Draw = { feedstockId: string; wetKg: number };
type PileEntry = { wetDeltaKg: number | null; intake?: Batch; draws?: readonly Draw[] };

/** Saved batch draws remain exact; only the unassigned stock change is estimated pro rata. */
export function feedstockPile(batches: readonly Batch[], draws: readonly Draw[], currentWetKg: number) {
  const remaining = batches.map(batch => ({ ...batch,
    remainingWetKg: Math.max(0, batch.wetKg - draws.filter(draw => draw.feedstockId === batch.id).reduce((sum, draw) => sum + draw.wetKg, 0)),
  }));
  const total = remaining.reduce((sum, batch) => sum + batch.remainingWetKg, 0);
  return remaining.map(batch => {
    const wetKg = total > 0 ? Math.max(currentWetKg, 0) * batch.remainingWetKg / total : 0;
    return { id: batch.id, wetKg: round(wetKg), dryKg: batch.dryKg === null ? null : round(batch.wetKg > 0 ? wetKg * batch.dryKg / batch.wetKg : 0) };
  });
}

/** Replay the ledger prefix: an unassigned draw cannot consume a later intake. */
export function feedstockPileTimeline(entries: readonly PileEntry[]) {
  const pile = new Map<string, Batch>();
  const pendingDraws = new Map<string, number>();
  let wetKg = 0;
  let intakeWetKg = 0;
  let missingDryBasis = false;
  const points = entries.map(entry => {
    wetKg += entry.wetDeltaKg ?? 0;
    if (entry.intake) {
      const batch = entry.intake;
      const remaining = Math.max(0, batch.wetKg - (pendingDraws.get(batch.id) ?? 0));
      pile.set(batch.id, { ...batch, wetKg: remaining, dryKg: batch.dryKg === null ? null : batch.wetKg > 0 ? batch.dryKg * remaining / batch.wetKg : 0 });
      pendingDraws.delete(batch.id);
      intakeWetKg += batch.wetKg;
      missingDryBasis ||= batch.dryKg === null || (batch.dryKg > 0 && batch.wetKg <= 0);
    }
    for (const draw of entry.draws ?? []) {
      const batch = pile.get(draw.feedstockId);
      if (!batch) { pendingDraws.set(draw.feedstockId, (pendingDraws.get(draw.feedstockId) ?? 0) + draw.wetKg); continue; }
      const remaining = Math.max(0, batch.wetKg - draw.wetKg);
      batch.dryKg = batch.dryKg === null ? null : batch.wetKg > 0 ? batch.dryKg * remaining / batch.wetKg : 0;
      batch.wetKg = remaining;
    }
    const unassignedDelta = (entry.wetDeltaKg ?? 0) - (entry.intake?.wetKg ?? 0) + (entry.draws ?? []).reduce((sum, draw) => sum + draw.wetKg, 0);
    const total = [...pile.values()].reduce((sum, batch) => sum + batch.wetKg, 0);
    const factor = total > 0 ? Math.max(0, total + unassignedDelta) / total : 0;
    if (unassignedDelta !== 0) for (const batch of pile.values()) {
      batch.wetKg *= factor;
      if (batch.dryKg !== null) batch.dryKg *= factor;
    }
    const shares = feedstockPile([...pile.values()], [], wetKg);
    return { dryKg: wetKg === 0 ? 0 : intakeWetKg > 0 && !missingDryBasis ? round(shares.reduce((sum, batch) => sum + (batch.dryKg ?? 0), 0)) : null };
  });
  return { points, batches: feedstockPile([...pile.values()], [], wetKg) };
}
