/**
 * PROTOTYPE: the floating variant switcher for `/vehicles-and-crew?variant=`.
 * Outside the page content, hidden in production builds. Delete it with the
 * losing variants once a layout is picked.
 */
"use client";

import { useEffect } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";

export interface PrototypeVariant<V extends string> {
  key: V;
  name: string;
}

interface PrototypeVariantSwitcherProps<V extends string> {
  variants: ReadonlyArray<PrototypeVariant<V>>;
  current: V;
  onChange: (variant: V) => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function PrototypeVariantSwitcher<V extends string>({ variants, current, onChange }: PrototypeVariantSwitcherProps<V>) {
  const index = Math.max(0, variants.findIndex((variant) => variant.key === current));
  const step = (delta: number) => onChange(variants[(index + delta + variants.length) % variants.length].key);

  // Sanctioned effect: a window keyboard listener for the arrow keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  const variant = variants[index];
  return (
    <div
      role="group"
      aria-label="Prototype variant"
      className="fixed bottom-16 left-1/2 z-[var(--z-layer-toast)] flex -translate-x-1/2 items-center gap-4 rounded-full bg-[var(--ink)] p-4 text-white shadow-lg"
    >
      <button type="button" onClick={() => step(-1)} aria-label="Previous variant" className="flex size-36 items-center justify-center rounded-full hover:bg-white/15">
        <CaretLeftIcon size={16} weight="bold" aria-hidden />
      </button>
      <span className="whitespace-nowrap px-8 body-small font-medium">
        {variant.key.toUpperCase()} ({variant.name})
      </span>
      <button type="button" onClick={() => step(1)} aria-label="Next variant" className="flex size-36 items-center justify-center rounded-full hover:bg-white/15">
        <CaretRightIcon size={16} weight="bold" aria-hidden />
      </button>
    </div>
  );
}
