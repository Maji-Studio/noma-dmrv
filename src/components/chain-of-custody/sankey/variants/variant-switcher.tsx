"use client";

/**
 * PROTOTYPE: the variant pill, fixed bottom right outside the content (bottom left holds the Next dev badge). Links
 * keep every other search param. Delete with the losing variants.
 */
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export const SANKEY_VARIANTS = ["a", "b", "c"] as const;
export type SankeyVariant = (typeof SANKEY_VARIANTS)[number];

const LABELS: Record<SankeyVariant | "base", string> = {
  base: "Now",
  a: "A Waterfall",
  b: "B Records",
  c: "C Ribbon",
};

export function parseSankeyVariant(raw: string | null): SankeyVariant | null {
  return SANKEY_VARIANTS.find((variant) => variant === raw) ?? null;
}

export function SankeyVariantSwitcher() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = parseSankeyVariant(searchParams.get("variant"));
  const hrefFor = (variant: SankeyVariant | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (variant) params.set("variant", variant);
    else params.delete("variant");
    return `${pathname}?${params.toString()}`;
  };
  return (
    <nav
      aria-label="Prototype variants"
      className="fixed bottom-16 right-16 z-50 flex border-[1.5px] border-[var(--ink)] bg-[var(--paper)]"
    >
      {([null, ...SANKEY_VARIANTS] as const).map((variant) => {
        const active = variant === current;
        return (
          <Link
            key={variant ?? "base"}
            href={hrefFor(variant)}
            replace
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "body-caption flex min-h-44 items-center px-12 whitespace-nowrap",
              active ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--color-text-primary)] hover:bg-[var(--sea)]",
            )}
          >
            {LABELS[variant ?? "base"]}
          </Link>
        );
      })}
    </nav>
  );
}
