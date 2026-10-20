"use client";

/**
 * Throwaway: the prototype "Registry state" toggle for variant A. Dashed
 * border, like the "view as" toggle, so it never reads as product UI.
 */
import { useSettingsPrototypeParam } from "./use-settings-prototype-variant";
import {
  REGISTRY_PARAM,
  REGISTRY_STATE_OPTIONS,
  registryStateFromParam,
  type ARegistryState,
} from "./variant-a-registry-state";

export function useARegistryState(): [ARegistryState, (next: ARegistryState) => void] {
  const [value, set] = useSettingsPrototypeParam(REGISTRY_PARAM);
  return [
    registryStateFromParam(value),
    (next) => set(next === "connected" ? null : next),
  ];
}

export function ARegistryStateToggle() {
  const [state, setState] = useARegistryState();
  return (
    <label className="flex flex-wrap items-center gap-8 border border-dashed border-[var(--color-border-secondary)] px-8 py-4">
      <span className="body-caption text-[var(--color-text-tertiary)]">Prototype: registry state</span>
      <select
        value={state}
        onChange={(event) => setState(registryStateFromParam(event.target.value))}
        className="body-small h-44 min-w-[220px] flex-1 border border-[var(--color-border-secondary)] bg-[var(--paper)] px-8 md:h-36"
      >
        {REGISTRY_STATE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
