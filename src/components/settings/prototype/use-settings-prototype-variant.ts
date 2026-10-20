"use client";

/**
 * Throwaway: reads `?variant=A..E` for the settings prototype. Returns null
 * when the param is missing or invalid, so every gated change (sidebar chrome
 * included) is a no-op without it.
 */
import { useSearchParams } from "next/navigation";

import {
  parseSettingsPrototypeVariant,
  type SettingsPrototypeVariant,
} from "./settings-prototype-variants";

export {
  parseSettingsPrototypeVariant,
  SETTINGS_PROTOTYPE_VARIANTS,
  type SettingsPrototypeVariant,
} from "./settings-prototype-variants";

export function useSettingsPrototypeVariant(): SettingsPrototypeVariant | null {
  const params = useSearchParams();
  if (process.env.NODE_ENV === "production") return null;
  return parseSettingsPrototypeVariant(params.get("variant"));
}

/**
 * Prototype sub-state that the page and the sidebar chrome both read (which
 * pane is open, the Platform Admin view toggle). Kept in the URL so a sidebar
 * menu can open a pane, and written with history.replaceState, which Next
 * syncs into useSearchParams without a server round trip.
 */
export function useSettingsPrototypeParam(
  name: string,
): [string | null, (value: string | null) => void] {
  const params = useSearchParams();
  const value = params.get(name);
  const set = (next: string | null) => setSettingsPrototypeParams({ [name]: next });
  return [value, set];
}

export function setSettingsPrototypeParams(
  patch: Record<string, string | null>,
): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/** Href to the prototype route with the current params plus `patch`. */
export function settingsPrototypeHref(
  current: URLSearchParams,
  patch: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  return `/settings?${next.toString()}`;
}
