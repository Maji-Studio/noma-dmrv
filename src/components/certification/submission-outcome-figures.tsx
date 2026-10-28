/**
 * The before → after figures of a credit batch that no longer matches
 * Isometric. Values are saved raw on the drift event and formatted here, on
 * the facility clock.
 */
import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import { LedgerBeforeAfter } from "@/components/storage-locations/stock-ledger";
import type { DriftDifference } from "@/lib/certification/production-batch-drift-details";
import { formatFacilityTime } from "@/lib/date-utils";
import { formatMassKg } from "@/lib/format-utils";
import { ISOMETRIC_KILOGRAM_UNIT, kilogramUnitsMatch } from "@/lib/isometric/quantity-units";

const WINDOW_FORMATS = ["MMM d, yyyy, HH:mm", "MMM d, yyyy, HH:mm:ss"] as const;
const MILLISECOND_DIGITS = 3;
const OFFSET_FORMAT = "xxx";
/** Qualifier for a registry id noma has no name for. */
const REGISTRY_RECORD = "Isometric record";

const LABELS: Record<DriftDifference["field"], string> = {
  facility: "Facility",
  feedstockTypes: "Feedstock types",
  kind: "Kind",
  dryMass: "Dry mass",
  windowStart: "Production window start",
  windowEnd: "Production window end",
};

function formatMass(mass: { magnitude: number; unit: string }): string {
  if (kilogramUnitsMatch(mass.unit, ISOMETRIC_KILOGRAM_UNIT)) {
    return formatMassKg(mass.magnitude, { digits: MASS_KG_STORAGE_DECIMALS });
  }
  return `${mass.magnitude.toLocaleString(undefined, { maximumFractionDigits: MASS_KG_STORAGE_DECIMALS })} ${mass.unit}`;
}

function formatInstant(value: string, timeZone: string, pattern: string, withMillis: boolean): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return value;
  const millis = withMillis ? `.${String(instant.getUTCMilliseconds()).padStart(MILLISECOND_DIGITS, "0")}` : "";
  return `${formatFacilityTime(instant, timeZone, pattern)}${millis}`;
}

/** Minutes first; seconds, then milliseconds, only when both values would print the same. */
function formatInstantPair(registry: string, noma: string, timeZone: string): [string, string] {
  for (const pattern of WINDOW_FORMATS) {
    const left = formatInstant(registry, timeZone, pattern, false);
    const right = formatInstant(noma, timeZone, pattern, false);
    if (left !== right) return [left, right];
  }
  const left = formatInstant(registry, timeZone, WINDOW_FORMATS[1], true);
  const right = formatInstant(noma, timeZone, WINDOW_FORMATS[1], true);
  if (left !== right) return [left, right];
  // A repeated DST hour prints the same wall clock twice: say which one by its UTC offset.
  return [`${left} ${formatInstant(registry, timeZone, OFFSET_FORMAT, false)}`, `${right} ${formatInstant(noma, timeZone, OFFSET_FORMAT, false)}`];
}

/** Isometric value and noma value as display strings. */
export function formatDifference(difference: DriftDifference, timeZone: string): { label: string; isometric: string; noma: string } {
  const label = LABELS[difference.field];
  switch (difference.field) {
    case "feedstockTypes":
      return {
        label,
        isometric: difference.isometricLabel ?? difference.isometric.map((id) => `${REGISTRY_RECORD} ${id}`).join(", "),
        noma: difference.nomaLabel ?? difference.noma.map((id) => `${REGISTRY_RECORD} ${id}`).join(", "),
      };
    case "dryMass":
      return { label, isometric: formatMass(difference.isometric), noma: formatMass(difference.noma) };
    case "windowStart":
    case "windowEnd": {
      const [isometric, noma] = formatInstantPair(difference.isometric, difference.noma, timeZone);
      return { label, isometric, noma };
    }
    case "facility":
      return {
        label,
        isometric: difference.isometricLabel ?? `${REGISTRY_RECORD} ${difference.isometric}`,
        noma: difference.nomaLabel ?? `${REGISTRY_RECORD} ${difference.noma}`,
      };
    default:
      return { label, isometric: difference.isometric, noma: difference.noma };
  }
}

export function FigurePairs({ differences, timeZone }: { differences: DriftDifference[]; timeZone: string }) {
  return (
    <div className="flex flex-col gap-8">
      {differences.map((difference) => {
        const figure = formatDifference(difference, timeZone);
        return (
          <LedgerBeforeAfter
            key={difference.field}
            title={figure.label}
            labels={["In Isometric", "In noma"]}
            before={figure.isometric}
            after={figure.noma}
          />
        );
      })}
    </div>
  );
}
