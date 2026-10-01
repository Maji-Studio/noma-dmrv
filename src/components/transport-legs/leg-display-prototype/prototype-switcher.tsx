/**
 * PROTOTYPE switcher for the transport leg display (`?leg=`). Not for merge.
 *
 * Floats bottom-left, portaled to body so it sits outside the side sheet. The
 * sheet is a modal Base UI dialog, so a press outside it would close it: a
 * window capture listener swallows presses on the bar before the dialog sees
 * them and runs the bar's action itself.
 *
 * Writes `?leg=` with history.replaceState(null, …). Passing Next's own history
 * state makes Next treat the call as internal and skip syncing useSearchParams.
 */
"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";

export const LEG_VARIANTS = [
  { key: "0", name: "Current" },
  { key: "A", name: "Route strip" },
  { key: "B", name: "Itinerary" },
  { key: "C", name: "Ledger rows" },
  { key: "D", name: "Mass × distance" },
  { key: "E", name: "Route sentence" },
  { key: "F", name: "Route fields" },
] as const;

export type LegVariantKey = (typeof LEG_VARIANTS)[number]["key"];

const PARAM = "leg";
const PRESS_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click"] as const;

export function useLegVariant(): LegVariantKey {
  // Null outside the Next router (unit tests): those keep the current display.
  // In the app, no param opens the newest variant.
  const params = useSearchParams();
  if (!params) return "0";
  const value = params.get(PARAM)?.toUpperCase();
  return LEG_VARIANTS.find((variant) => variant.key === value)?.key ?? "E";
}

function setVariant(key: LegVariantKey) {
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, key);
  window.history.replaceState(null, "", url);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const noopSubscribe = () => () => {};

// Every journey on screen mounts a switcher; only the first one claims the bar,
// or two bars would each step the variant on one press.
let claimed: symbol | null = null;

export function LegPrototypeSwitcher() {
  const current = useLegVariant();
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const barRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<symbol>(Symbol("leg-switcher"));
  const index = LEG_VARIANTS.findIndex((variant) => variant.key === current);
  const step = (delta: number) =>
    setVariant(LEG_VARIANTS[(index + delta + LEG_VARIANTS.length) % LEG_VARIANTS.length].key);

  useEffect(() => {
    const token = tokenRef.current;
    if (claimed === null) claimed = token;
    if (claimed !== token) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    const onPress = (event: Event) => {
      const bar = barRef.current;
      if (!bar || !(event.target instanceof Node) || !bar.contains(event.target)) return;
      event.stopPropagation();
      event.preventDefault();
      if (event.type !== "click") return;
      const direction = (event.target as Element).closest?.("[data-step]")?.getAttribute("data-step");
      if (direction) step(Number(direction));
    };
    window.addEventListener("keydown", onKey, true);
    for (const type of PRESS_EVENTS) window.addEventListener(type, onPress, true);
    return () => {
      if (claimed === token) claimed = null;
      window.removeEventListener("keydown", onKey, true);
      for (const type of PRESS_EVENTS) window.removeEventListener(type, onPress, true);
    };
  });

  if (process.env.NODE_ENV === "production" || !mounted) return null;
  if (claimed !== null && claimed !== tokenRef.current) return null;
  const variant = LEG_VARIANTS[index];
  return createPortal(
    <div
      ref={barRef}
      data-leg-prototype-switcher
      className="pointer-events-auto fixed bottom-24 left-24 z-[2147483647] flex select-none items-center gap-4 rounded-full bg-[var(--clr-dark-purple)] p-4 text-white shadow-lg"
    >
      <span data-step="-1" role="button" aria-label="Previous variant" className="flex size-36 cursor-pointer items-center justify-center rounded-full hover:bg-white/15">
        <CaretLeftIcon size={16} weight="bold" />
      </span>
      <span className="flex min-w-[220px] flex-col items-center px-8">
        <span className="body-small font-medium">{variant.key} · {variant.name}</span>
        <span className="body-caption opacity-60">Transport leg prototype {index + 1} of {LEG_VARIANTS.length}</span>
      </span>
      <span data-step="1" role="button" aria-label="Next variant" className="flex size-36 cursor-pointer items-center justify-center rounded-full hover:bg-white/15">
        <CaretRightIcon size={16} weight="bold" />
      </span>
    </div>,
    document.body,
  );
}
