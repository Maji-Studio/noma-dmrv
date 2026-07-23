const MASS_KG_STORAGE_SCALE = 3;
const MOISTURE_RATIO_STORAGE_SCALE = 6;
const MOISTURE_RATIO_SCALE_FACTOR = BigInt(1_000_000);
const TEN = BigInt(10);

export interface CanonicalFeedstockStockTake {
  countedWetMassKg: number;
  moistureRatioUsed: number;
  countedMassKg: number;
}

function powerOfTen(exponent: number): bigint {
  let result = BigInt(1);
  for (let index = 0; index < exponent; index += 1) {
    result *= TEN;
  }
  return result;
}

function divideHalfUp(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  const remainder = value % divisor;
  return remainder * BigInt(2) >= divisor ? quotient + BigInt(1) : quotient;
}

/**
 * Convert a non-negative JavaScript number to a scaled integer using the same
 * tie rule as PostgreSQL NUMERIC: positive half steps round away from zero.
 * Parsing the number's decimal representation avoids binary multiplication
 * moving an exact decimal tie just below its rounding boundary.
 */
function toScaledInteger(value: number, scale: number): bigint {
  const [coefficient, exponentText = "0"] = value
    .toString()
    .toLowerCase()
    .split("e");
  const [integerPart, fractionalPart = ""] = coefficient.split(".");
  const digits = BigInt(`${integerPart}${fractionalPart}`);
  const decimalPlaces = fractionalPart.length - Number(exponentText);
  const scaleShift = scale - decimalPlaces;

  if (scaleShift >= 0) {
    return digits * powerOfTen(scaleShift);
  }

  return divideHalfUp(digits, powerOfTen(-scaleShift));
}

function fromScaledInteger(value: bigint, scale: number): number {
  return Number(value) / 10 ** scale;
}

/**
 * Canonicalize a feedstock stock-take before deriving its dry mass.
 *
 * Wet mass and moisture ratio are rounded to their database storage scales
 * first. Dry mass is then derived with integer arithmetic and rounded to the
 * mass storage scale, keeping the client preview and server decision identical.
 */
export function canonicalizeFeedstockStockTake(
  countedWetMassKg: number,
  moistureRatioUsed: number,
): CanonicalFeedstockStockTake {
  if (!Number.isFinite(countedWetMassKg) || countedWetMassKg < 0) {
    throw new RangeError("countedWetMassKg must be a finite number >= 0");
  }
  if (
    !Number.isFinite(moistureRatioUsed) ||
    moistureRatioUsed < 0 ||
    moistureRatioUsed > 1
  ) {
    throw new RangeError("moistureRatioUsed must be between 0 and 1");
  }

  const wetMassUnits = toScaledInteger(
    countedWetMassKg,
    MASS_KG_STORAGE_SCALE,
  );
  const moistureRatioUnits = toScaledInteger(
    moistureRatioUsed,
    MOISTURE_RATIO_STORAGE_SCALE,
  );
  const dryMassUnits = divideHalfUp(
    wetMassUnits * (MOISTURE_RATIO_SCALE_FACTOR - moistureRatioUnits),
    MOISTURE_RATIO_SCALE_FACTOR,
  );

  return {
    countedWetMassKg: fromScaledInteger(
      wetMassUnits,
      MASS_KG_STORAGE_SCALE,
    ),
    moistureRatioUsed: fromScaledInteger(
      moistureRatioUnits,
      MOISTURE_RATIO_STORAGE_SCALE,
    ),
    countedMassKg: fromScaledInteger(dryMassUnits, MASS_KG_STORAGE_SCALE),
  };
}
