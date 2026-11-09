import * as React from "react";
import { Button } from "./button";
import { INLINE_HIT_AREA } from "./touch-target";
import { cn } from "@/lib/utils";

/**
 * The default `Button` pads its label by 16px (`px-16`); this pulls the label
 * back so it lines up with the text above it. `.label-button` resets `margin`
 * on the button itself, so the pull sits on a wrapper. Keep it equal to the
 * Button's horizontal padding.
 */
const TEXT_ACTION_BLEED = "-ml-16";

/**
 * A mono uppercase text action under a list or paragraph ("Show all 5"): the
 * same `noOutline` Button as "Back to summary", its label flush with the
 * content above and a 44px hit area at every width. Put it in a flex column.
 */
export function TextAction({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <div className={cn("self-start", TEXT_ACTION_BLEED)}>
      <Button variant="noOutline" className={cn(INLINE_HIT_AREA, className)} {...props} />
    </div>
  );
}
