import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { getRunConflict } from "@/lib/production-runs/overlap-conflict";

/**
 * Footer for a refused production run save. An overlap conflict is rethrown
 * first: the form files it at the start time with a link to the conflicting
 * run, and the refusal handler would swallow it into the footer.
 */
export function footerForRefusedSave(
  error: unknown,
  fallback: string,
  onRefusal: SaveRefusalHandler,
): string | null {
  if (getRunConflict(error)) throw error;
  return onRefusal(error, fallback);
}
