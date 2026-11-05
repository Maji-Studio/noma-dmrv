"use client";

import type { KeyboardEvent } from "react";

interface TablistKeysOptions<K extends string> {
  /** Tab keys in display order. */
  keys: readonly K[];
  selected: K;
  /** Selects the tab (Left/Right/Home/End select as they move focus). */
  onSelect: (key: K) => void;
  /** The DOM id of a tab button, so focus can follow the selection. */
  tabId: (key: K) => string;
}

function nextKey<K extends string>(keys: readonly K[], current: K, key: string): K | null {
  const index = keys.indexOf(current);
  switch (key) {
    case "ArrowRight":
      return keys[(index + 1) % keys.length]!;
    case "ArrowLeft":
      return keys[(index - 1 + keys.length) % keys.length]!;
    case "Home":
      return keys[0]!;
    case "End":
      return keys[keys.length - 1]!;
    default:
      return null;
  }
}

/**
 * The WAI-ARIA tabs keyboard pattern for a row of tab buttons: one tab stop
 * (roving tabindex), Left/Right wrap, Home/End jump, and each of them selects
 * the tab it moves to. Spread the result of `tabProps(key)` onto the tab button.
 */
export function useTablistKeys<K extends string>({ keys, selected, onSelect, tabId }: TablistKeysOptions<K>) {
  return (key: K) => ({
    tabIndex: selected === key ? 0 : -1,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const target = nextKey(keys, key, event.key);
      if (!target) return;
      event.preventDefault();
      onSelect(target);
      document.getElementById(tabId(target))?.focus();
    },
  });
}
