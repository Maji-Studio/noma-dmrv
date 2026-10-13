const MASS_PRECISION = 1_000;
const round = (kg: number) => Math.round(kg * MASS_PRECISION) / MASS_PRECISION;

/** Saved batch draws remain exact; only the unassigned stock change is estimated pro rata. */
export function feedstockPile(batches: readonly { id: string; wetKg: number; dryKg: number | null }[], draws: readonly { feedstockId: string; wetKg: number }[], currentWetKg: number) {
  const remaining = batches.map(batch => ({ ...batch,
    remainingWetKg: Math.max(0, batch.wetKg - draws.filter(draw => draw.feedstockId === batch.id).reduce((sum, draw) => sum + draw.wetKg, 0)),
  }));
  const total = remaining.reduce((sum, batch) => sum + batch.remainingWetKg, 0);
  return remaining.map(batch => {
    const wetKg = total > 0 ? Math.max(currentWetKg, 0) * batch.remainingWetKg / total : 0;
    return { id: batch.id, wetKg: round(wetKg), dryKg: batch.dryKg === null ? null : round(batch.wetKg > 0 ? wetKg * batch.dryKg / batch.wetKg : 0) };
  });
}
