export type DeliveryDryMassSource = 'measured' | 'derived' | 'missing';

export type ResolveDeliveryDryMassInput = {
  measuredMassDryKg?: number | null;
  deliveredWetMassKg?: number | null;
  moisturePercent?: number | null;
};

export type ResolveDeliveryDryMassResult = {
  massDryKg: number | null;
  source: DeliveryDryMassSource;
  creditReady: boolean;
  reason?: string;
};

function roundKg(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function deriveMassDryKg(
  deliveredWetMassKg: number,
  moisturePercent: number
): number {
  if (deliveredWetMassKg < 0) {
    throw new RangeError('deliveredWetMassKg must be >= 0');
  }

  if (moisturePercent < 0 || moisturePercent > 100) {
    throw new RangeError('moisturePercent must be between 0 and 100');
  }

  return roundKg(deliveredWetMassKg * (1 - moisturePercent / 100));
}

export function deriveMassDryKgWithAddedWater(
  wetMassKg: number,
  moisturePercent: number,
  addedWaterKg: number | null | undefined
): number {
  const waterAddedKg = addedWaterKg ?? 0;

  if (waterAddedKg < 0) {
    throw new RangeError('addedWaterKg must be >= 0');
  }

  return deriveMassDryKg(wetMassKg + waterAddedKg, moisturePercent);
}

/** Compute dry mass clamped to wet mass (dry can never exceed wet). */
export function computeClampedDryMass(
  wetMassKg: number | null | undefined,
  moisturePercent: number | null | undefined
): number | null {
  if (wetMassKg == null || moisturePercent == null) return null;
  if (!Number.isFinite(wetMassKg) || !Number.isFinite(moisturePercent)) {
    return null;
  }
  if (wetMassKg < 0 || moisturePercent < 0 || moisturePercent > 100) {
    return null;
  }
  return Math.min(deriveMassDryKg(wetMassKg, moisturePercent), wetMassKg);
}

export function resolveDeliveryDryMass(
  input: ResolveDeliveryDryMassInput
): ResolveDeliveryDryMassResult {
  const measuredMassDryKg = input.measuredMassDryKg ?? null;
  const deliveredWetMassKg = input.deliveredWetMassKg ?? null;
  const moisturePercent = input.moisturePercent ?? null;

  if (measuredMassDryKg != null) {
    if (measuredMassDryKg < 0) {
      throw new RangeError('measuredMassDryKg must be >= 0');
    }

    if (deliveredWetMassKg != null && measuredMassDryKg > deliveredWetMassKg) {
      throw new RangeError(
        'measuredMassDryKg must be <= deliveredWetMassKg when both are provided'
      );
    }

    return {
      massDryKg: roundKg(measuredMassDryKg),
      source: 'measured',
      creditReady: true,
    };
  }

  if (deliveredWetMassKg != null && moisturePercent != null) {
    return {
      massDryKg: deriveMassDryKg(deliveredWetMassKg, moisturePercent),
      source: 'derived',
      creditReady: true,
    };
  }

  const missingInputs: string[] = [];
  if (deliveredWetMassKg == null) missingInputs.push('deliveredWetMassKg');
  if (moisturePercent == null) missingInputs.push('moisturePercent');

  return {
    massDryKg: null,
    source: 'missing',
    creditReady: false,
    reason: `Missing dry-mass inputs: ${missingInputs.join(', ')}`,
  };
}
