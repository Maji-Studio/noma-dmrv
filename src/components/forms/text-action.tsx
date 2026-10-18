import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The quiet text action: caption-size sentence-case primary ink that underlines on hover,
 * with a 44px touch target. Cards and field cues both use it, so a text action
 * looks the same wherever it sits. The `!` utilities beat the Button's unlayered
 * mono caps `.label-button` rule. `className` adds placement (margins).
 */
export function TextAction({ className, ...props }: Omit<ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button
      type="button"
      variant="noOutline"
      className={cn(
        "inline-flex min-h-44 shrink-0 items-center gap-6 px-6 body-caption !font-[family-name:var(--font-standard)] !normal-case text-[var(--color-text-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
        className,
      )}
      {...props}
    />
  );
}
