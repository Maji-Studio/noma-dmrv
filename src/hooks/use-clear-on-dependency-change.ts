/**
 * useClearOnDependencyChange
 *
 * Clears a form field when upstream dependency value(s) change.
 * Skips the initial mount so default/edit values aren't wiped.
 *
 * Works with any field — use inside FormEntitySelect (via `dependsOn` prop)
 * or call directly in custom form components.
 *
 * @example
 * // Single dependency
 * useClearOnDependencyChange(watchedFeedstockTypeId, field.onChange);
 *
 * // Multiple dependencies
 * useClearOnDependencyChange([watchedFacilityId, watchedFeedstockTypeId], field.onChange);
 */
import { useRef, useEffect } from "react";

export function useClearOnDependencyChange(
  dependsOn: string | null | undefined | (string | null | undefined)[],
  onChange: (value: unknown) => void
) {
  // Normalize to array for uniform handling
  const deps = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
  const serialized = deps.join("\0");

  const prevRef = useRef(serialized);
  const mountedRef = useRef(false);

  const enabled = dependsOn !== undefined;

  useEffect(() => {
    if (!enabled) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevRef.current = serialized;
      return;
    }
    if (prevRef.current !== serialized) {
      prevRef.current = serialized;
      onChange(null);
    }
  }, [enabled, serialized, onChange]);
}
