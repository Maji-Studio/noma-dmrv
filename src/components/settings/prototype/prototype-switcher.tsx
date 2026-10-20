"use client";

/**
 * Throwaway: floating variant switcher for the settings prototype. Bottom
 * centre, arrow keys cycle (ignored while typing), updates `?variant=` with
 * router.replace. Hidden in production builds.
 */
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import {
  SETTINGS_PROTOTYPE_VARIANTS,
  type SettingsPrototypeVariant,
} from "./use-settings-prototype-variant";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function PrototypeSwitcher({
  current,
  names,
}: {
  current: SettingsPrototypeVariant;
  names: Record<SettingsPrototypeVariant, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const index = SETTINGS_PROTOTYPE_VARIANTS.indexOf(current);
  const count = SETTINGS_PROTOTYPE_VARIANTS.length;

  const go = (delta: number) => {
    const next = SETTINGS_PROTOTYPE_VARIANTS[(index + delta + count) % count];
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div
      role="group"
      aria-label="Prototype variant"
      className="fixed bottom-16 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-8 border-[1.5px] border-[var(--clr-dark-purple)] bg-[var(--paper)] px-8 py-4 shadow-lg"
    >
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous variant"
        className="flex size-44 shrink-0 items-center justify-center hover:bg-[var(--clr-dark-purple-10)]"
      >
        <CaretLeftIcon size={16} aria-hidden />
      </button>
      <span className="body-small min-w-0 truncate whitespace-nowrap px-4 font-medium">
        {current}. {names[current]}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next variant"
        className="flex size-44 shrink-0 items-center justify-center hover:bg-[var(--clr-dark-purple-10)]"
      >
        <CaretRightIcon size={16} aria-hidden />
      </button>
    </div>
  );
}
