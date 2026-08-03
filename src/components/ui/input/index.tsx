import * as React from "react"
import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export function preventNumberInputWheelChange(
  event: React.WheelEvent<HTMLInputElement>
) {
  // Removing focus before the browser's default wheel action prevents stepping
  // while still allowing the surrounding page or panel to scroll.
  event.currentTarget.blur()
}

const NUMBER_INPUT_STEP_KEYS = new Set(["ArrowUp", "ArrowDown"])

export function preventNumberInputKeyChange(
  event: React.KeyboardEvent<HTMLInputElement>
) {
  if (NUMBER_INPUT_STEP_KEYS.has(event.key)) {
    event.preventDefault()
  }
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onKeyDown, onWheel, ...props }, ref) => {
    return (
      <input
        type={type}
        onKeyDown={(event) => {
          onKeyDown?.(event)

          if (type === "number" && !event.defaultPrevented) {
            preventNumberInputKeyChange(event)
          }
        }}
        onWheel={(event) => {
          onWheel?.(event)

          if (type === "number" && !event.defaultPrevented) {
            preventNumberInputWheelChange(event)
          }
        }}
        className={cn(
          "flex h-40 w-full border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:border-[var(--color-interaction)] focus-visible:ring-1 focus-visible:ring-[var(--color-interaction)] disabled:cursor-not-allowed disabled:opacity-50 rounded-none",
          "shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
