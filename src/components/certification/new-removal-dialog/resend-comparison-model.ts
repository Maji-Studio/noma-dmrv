import { displayUnit, formatMagnitude } from "@/components/emissions/emission-line-display";
import type { RemovalResendComparison } from "@/lib/certification/removal-resend-comparison";

export const NOT_SENT_BEFORE = "Not sent before";
export const NOT_IN_THIS_VERSION = "Not in this version";

export interface ResendChangeRow {
  key: string;
  label: string;
  before: string;
  after: string;
  /** The side that has no value at all: an added or removed line, never shown as zero. */
  addedOrRemoved: boolean;
}

function figure(side: { value: number; unit: string } | null, absent: string): string {
  return side ? `${formatMagnitude(side.value)} ${displayUnit(side.unit)}`.trim() : absent;
}

/** "diesel_litres" reads "Diesel litres" when the review has no name for the component. */
function fallbackLabel(inputKey: string): string {
  const words = inputKey.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : inputKey;
}

/**
 * The lines whose figure differs from the version sent before, as before and after text.
 * Unchanged lines are left out. Null when the earlier snapshot could not be read.
 */
export function buildResendChangeRows(
  comparison: RemovalResendComparison,
  componentName: (componentId: string) => string | undefined,
): ResendChangeRow[] | null {
  if (!comparison.lines) return null;
  const linesPerComponent = new Map<string, number>();
  for (const line of comparison.lines) linesPerComponent.set(line.componentId, (linesPerComponent.get(line.componentId) ?? 0) + 1);
  return comparison.lines
    .map((line) => {
      const name = componentName(line.componentId);
      // One component with several inputs: the input tells the rows apart.
      const label = name === undefined
        ? fallbackLabel(line.inputKey)
        : (linesPerComponent.get(line.componentId) ?? 0) > 1 ? `${name}, ${fallbackLabel(line.inputKey).toLowerCase()}` : name;
      return {
        key: `${line.componentId}:${line.inputKey}`,
        label,
        before: figure(line.previous, NOT_SENT_BEFORE),
        after: figure(line.current, NOT_IN_THIS_VERSION),
        addedOrRemoved: !line.previous || !line.current,
      };
    })
    // Compared as shown: a difference below what the figure displays is not a difference to the operator.
    .filter((row) => row.before !== row.after);
}
