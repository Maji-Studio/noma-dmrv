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
import { productionBatchMassUnitsMatch } from "@/lib/isometric/production-batches";

const WINDOW_FORMATS = ["MMM d, yyyy, HH:mm", "MMM d, yyyy, HH:mm:ss"] as const;
const MILLISECOND_DIGITS = 3;

const LABELS: Record<DriftDifference["field"], string> = {
  facility: "Facility",
  feedstockTypes: "Feedstock types",
  kind: "Kind",
  dryMass: "Dry mass",
  windowStart: "Production window start",
  windowEnd: "Production window end",
};

function formatMass(mass: { magnitude: number; unit: string }): string {
  if (productionBatchMassUnitsMatch(mass.unit, "kg")) {
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
  return [formatInstant(registry, timeZone, WINDOW_FORMATS[1], true), formatInstant(noma, timeZone, WINDOW_FORMATS[1], true)];
}

/** Isometric value and noma value as display strings. */
export function formatDifference(difference: DriftDifference, timeZone: string): { label: string; isometric: string; noma: string } {
  const label = LABELS[difference.field];
  switch (difference.field) {
    case "feedstockTypes":
      return { label, isometric: difference.isometric.join(", "), noma: difference.noma.join(", ") };
    case "dryMass":
      return { label, isometric: formatMass(difference.isometric), noma: formatMass(difference.noma) };
    case "windowStart":
    case "windowEnd": {
      const [isometric, noma] = formatInstantPair(difference.isometric, difference.noma, timeZone);
      return { label, isometric, noma };
    }
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
