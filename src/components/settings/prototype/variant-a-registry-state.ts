/**
 * Throwaway: the prototype "Registry state" for variant A, kept in
 * `?registry=` so a link opens straight into one state. No param means the
 * full connected state.
 */

export type ARegistryState = "none" | "keys-missing" | "connected" | "failing";

export const REGISTRY_PARAM = "registry";

export const REGISTRY_STATE_OPTIONS: readonly { value: ARegistryState; label: string }[] = [
  { value: "none", label: "No registry yet" },
  { value: "keys-missing", label: "Isometric, keys not saved" },
  { value: "connected", label: "Isometric connected" },
  { value: "failing", label: "Connection failing" },
];

export function registryStateFromParam(value: string | null): ARegistryState {
  return value === "none" || value === "keys-missing" || value === "failing"
    ? value
    : "connected";
}

/** Rail items that exist only because the organization uses a registry. */
export function registryChosen(state: ARegistryState): boolean {
  return state !== "none";
}

/** The registry answers and its keys work, so registry-backed data is live. */
export function registryLive(state: ARegistryState): boolean {
  return state === "connected";
}
