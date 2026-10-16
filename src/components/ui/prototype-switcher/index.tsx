/**
 * PrototypeSwitcher: the floating bottom bar for in-app UI prototypes
 * (`prototype` skill, UI branch). It cycles a `?variant=` search param with
 * the arrows or the ← → keys and carries a collapsible panel that shows the
 * prototype's current stub state. Never renders in production builds.
 */
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretLeftIcon, CaretRightIcon, CaretUpIcon, CaretDownIcon } from "@phosphor-icons/react/dist/ssr";

export interface PrototypeVariant {
  key: string;
  name: string;
}

interface PrototypeSwitcherProps {
  variants: readonly PrototypeVariant[];
  /** Search param that holds the variant key. */
  param?: string;
  /** Short name of the prototype, shown in the state panel heading. */
  title?: string;
  /** Current stub state, rendered in the collapsible panel. */
  children?: ReactNode;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function resolveVariant(variants: readonly PrototypeVariant[], value: string | null): PrototypeVariant {
  return variants.find((variant) => variant.key === value?.toUpperCase()) ?? variants[0];
}

export function PrototypeSwitcher({ variants, param = "variant", title = "Prototype", children }: PrototypeSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [panelOpen, setPanelOpen] = useState(false);
  const current = resolveVariant(variants, searchParams.get(param));
  const index = variants.indexOf(current);

  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, next.key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // External-system sync: a window key listener for ← and →.
  useEffect(() => {
    if (IS_PRODUCTION) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || document.querySelector("[role=dialog]")) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (IS_PRODUCTION) return null;

  return (
    <div
      data-prototype-switcher
      className="fixed bottom-64 sm:bottom-16 left-1/2 z-[calc(var(--z-layer-sheet-backdrop)-1)] flex w-[calc(100%-32px)] max-w-[420px] -translate-x-1/2 flex-col bg-[var(--ink)] text-[var(--paper)] outline outline-2 outline-[var(--clr-orange)]"
    >
      {panelOpen && children && (
        <div className="max-h-[50vh] overflow-y-auto border-b border-[var(--color-text-white-secondary)] px-16 py-12 body-caption">
          <div className="mb-8 font-medium">{title}: stub state</div>
          {children}
        </div>
      )}
      <div className="flex items-center gap-4 px-4 py-4">
        <button type="button" onClick={() => go(-1)} aria-label="Previous variant" className="flex size-40 shrink-0 items-center justify-center hover:bg-[var(--clr-dark-purple-80)]">
          <CaretLeftIcon size={20} weight="bold" />
        </button>
        <p className="min-w-0 flex-1 truncate text-center body-small font-medium" aria-live="polite">
          {current.key} ({current.name})
        </p>
        <button type="button" onClick={() => go(1)} aria-label="Next variant" className="flex size-40 shrink-0 items-center justify-center hover:bg-[var(--clr-dark-purple-80)]">
          <CaretRightIcon size={20} weight="bold" />
        </button>
        {children && (
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
            aria-label={panelOpen ? "Hide stub state" : "Show stub state"}
            className="flex size-40 shrink-0 items-center justify-center border-l border-[var(--color-text-white-secondary)] hover:bg-[var(--clr-dark-purple-80)]"
          >
            {panelOpen ? <CaretDownIcon size={20} weight="bold" /> : <CaretUpIcon size={20} weight="bold" />}
          </button>
        )}
      </div>
    </div>
  );
}
