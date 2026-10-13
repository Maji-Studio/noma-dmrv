/** One entry on a feedstock bin's stock timeline. Wet mass is the bin's stock currency. */
export interface FeedstockLedgerEntry {
  id: string;
  sourceId: string | null;
  kind: 'intake' | 'run_draw' | 'ingredient_draw' | 'loss' | 'count';
  /** ISO 8601 UTC instant the event physically happened. */
  occurredAt: string;
  recordedAt: string;
  actorName: string | null;
  /** The feedstock batch, production run or product behind the entry. */
  code: string | null;
  reason: string;
  /** Signed: intakes positive, draws and losses negative; null for an intake without wet mass. */
  wetDeltaKg: number | null;
  /** A stock-take's counted wet mass. */
  countedWetKg: number | null;
  moisturePercent: number | null;
  beforeWetKg: number;
  afterWetKg: number;
  /** Dry solids after the entry at the received batches' dry-to-wet ratio; an estimate. */
  estimatedDryKg: number | null;
}

/** A batch's remaining stock after saved shares and estimated unassigned draws. */
export interface FeedstockPileBatch {
  id: string;
  code: string;
  receivedAt: string;
  /** The batch's share of the pile's wet stock now. */
  wetKg: number;
  /** What the batch brought in. */
  intakeWetKg: number;
  /** Estimated solids remaining, unknown when the intake basis is incomplete. */
  dryKg: number | null;
  moisturePercent: number | null;
}

export interface FeedstockBinStock {
  currentWetKg: number;
  /** True only when a completed intake lacks its mass basis. */
  missingDryBasis: boolean;
  /** Oldest first. */
  entries: FeedstockLedgerEntry[];
  /** Oldest first. */
  batches: FeedstockPileBatch[];
}
