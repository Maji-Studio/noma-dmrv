/**
 * PROTOTYPE — throwaway. Delete with the variants it switches between.
 *
 * Floating bottom bar that cycles a `?variant=` search param. Deliberately
 * loud and un-designed so it never reads as part of the surface being judged.
 * Never renders in production builds.
 */
"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";

export interface PrototypeVariant {
  /** URL value, e.g. "A". */
  key: string;
  /** Short human name shown in the bar, e.g. "Dense rows". */
  name: string;
}

const VARIANT_PARAM = "variant";

/**
 * Prototype variants are throwaway UI and must be unreachable in production.
 * The early return alone was not enough: it ran AFTER `useEffect`, so the global
 * arrow-key listener still registered in production and could rewrite the URL to
 * `?variant=…`. Gate every effect and navigation on this, not just the render.
 */
const PROTOTYPES_ENABLED = process.env.NODE_ENV !== "production";

/**
 * Reads the active variant key, falling back to the first one.
 *
 * In production the `?variant=` param is ignored outright and the first variant
 * (the real, shipped surface) always wins. Hiding only the switcher was not
 * enough: a hand-typed `?variant=B` still rendered a throwaway prototype board
 * to a real user. Gating here covers every consumer, including future ones.
 */
export function usePrototypeVariant(variants: readonly PrototypeVariant[]) {
  const searchParams = useSearchParams();
  const requested = searchParams.get(VARIANT_PARAM);
  if (!PROTOTYPES_ENABLED) return variants[0].key;
  const match = variants.find((variant) => variant.key === requested);
  return match?.key ?? variants[0].key;
}

interface PrototypeSwitcherProps {
  variants: readonly PrototypeVariant[];
  current: string;
}

export function PrototypeSwitcher({ variants, current }: PrototypeSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const index = Math.max(
    variants.findIndex((variant) => variant.key === current),
    0,
  );

  const goTo = (offset: number) => {
    if (!PROTOTYPES_ENABLED) return;
    const next = variants[(index + offset + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams.toString());
    params.set(VARIANT_PARAM, next.key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (!PROTOTYPES_ENABLED) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      goTo(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!PROTOTYPES_ENABLED) return null;

  const active = variants[index];

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[9999] flex justify-center px-16">
      <div className="pointer-events-auto flex items-stretch border-[1.5px] border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)] shadow-[4px_4px_0_rgba(0,0,0,0.25)]">
        <button
          type="button"
          onClick={() => goTo(-1)}
          aria-label="Previous variant"
          className="flex h-40 w-40 items-center justify-center border-r border-[rgba(255,255,255,0.25)] transition-opacity hover:opacity-70"
        >
          <CaretLeftIcon size={16} weight="bold" />
        </button>
        <span className="flex h-40 items-center gap-8 px-16">
          <span className="label-micro opacity-60">Variant</span>
          <span className="label-micro">
            {active.key}: {active.name}
          </span>
          <span className="label-micro opacity-40">
            {index + 1}/{variants.length}
          </span>
        </span>
        <button
          type="button"
          onClick={() => goTo(1)}
          aria-label="Next variant"
          className="flex h-40 w-40 items-center justify-center border-l border-[rgba(255,255,255,0.25)] transition-opacity hover:opacity-70"
        >
          <CaretRightIcon size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}
