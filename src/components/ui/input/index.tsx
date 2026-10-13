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
const TEMPORAL_INPUT_TYPES = new Set(["date", "time", "datetime-local"])

// Preserve each engine's native host layout. WebKit's segmented editor must
// grow, and iOS's separate value part otherwise centres its text. Blink adds
// padding around its picker glyph; the field's px-12 already supplies it.
// Keep a start gap so narrow values do not touch the picker glyph.
export const TEMPORAL_INPUT_CLASSES = "[display:revert] text-left [&::-webkit-datetime-edit]:flex-1 [&::-webkit-datetime-edit]:min-w-0 [&::-webkit-datetime-edit]:p-0 [&::-webkit-date-and-time-value]:text-left [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:ms-8 [&::-webkit-calendar-picker-indicator]:p-0 [&::-webkit-calendar-picker-indicator]:shrink-0"

export function preventNumberInputKeyChange(
  event: React.KeyboardEvent<HTMLInputElement>
) {
  if (NUMBER_INPUT_STEP_KEYS.has(event.key)) {
    event.preventDefault()
  }
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onKeyDown, onWheel, ...props }, ref) => {
    const isTemporalInput = type !== undefined && TEMPORAL_INPUT_TYPES.has(type)
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
          "h-40 w-full border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 text-[var(--color-text-primary)] text-[var(--text-s)] transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:border-[var(--color-interaction)] focus-visible:ring-1 focus-visible:ring-[var(--color-interaction)] disabled:cursor-not-allowed disabled:opacity-50 rounded-none",
          isTemporalInput ? TEMPORAL_INPUT_CLASSES : "flex",
          type === "search" && "[&::-webkit-search-cancel-button]:mx-0",
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
