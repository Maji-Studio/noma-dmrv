import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { CircleNotch } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap label-button transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] disabled:pointer-events-none disabled:opacity-40 cursor-pointer rounded-none",
  {
    variants: {
      variant: {
        default: "border border-[var(--color-border-primary)] bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-medium)] active:bg-[var(--color-surface-light)]",
        weak: "border border-[var(--color-border-tertiary)] bg-transparent text-[var(--color-text-primary)] hover:border-[var(--color-border-primary)] hover:bg-[var(--color-surface-medium)]",
        primary: "bg-[var(--color-interaction)] text-white hover:bg-[var(--color-interaction-hover)] active:bg-[var(--color-interaction-active)] border-transparent",
        accent: "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-active)] border-transparent",
        noOutline: "border-transparent bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-medium)]",
      },
      size: {
        default: "h-[40px] px-16 gap-10",
        small: "h-[32px] px-12 gap-8 text-[length:var(--text-xs)]",
        large: "h-[48px] px-20 xl:h-[60px] xl:px-24 gap-12",
      },
      width: {
        default: "w-auto",
        square: "aspect-square p-0",
        full: "w-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      width: "default",
    },
  }
)

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /**
     * When true the button is disabled and shows a leading spinner — the one
     * convention for "this action is in flight", replacing the per-component
     * mix of spinner-in-button / text-swap / both.
     */
    busy?: boolean
  }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, width, type = "button", busy, disabled, children, ...props },
    ref
  ) => {
    return (
      <button
        type={type}
        className={cn(buttonVariants({ variant, size, width, className }))}
        ref={ref}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...props}
      >
        {busy && (
          <CircleNotch
            aria-hidden
            className="animate-spin shrink-0"
            size={16}
            weight="bold"
          />
        )}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
