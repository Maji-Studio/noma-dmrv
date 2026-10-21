import { cva } from "class-variance-authority";

export const tableVariants = cva(
  "w-full border-collapse",
  {
    variants: {
      variant: {
        default: "",
        bordered: "[border:var(--panel-border)]",
      },
      size: {
        default: "",
        compact: "[&_th]:py-6 [&_th]:px-8 [&_td]:py-4 [&_td]:px-8",
        comfortable: "[&_th]:py-16 [&_th]:px-16 [&_td]:py-12 [&_td]:px-16",
      },
    },
    defaultVariants: {
      variant: "bordered",
      size: "default",
    },
  }
);

export const tableRowVariants = cva(
  // 1px 10%-plum divider between rows (--hair-3 weight); the panel frame
  // closes the bottom, so the last row drops its divider.
  "[border-bottom:var(--row-divider)] last:[border-bottom:none] align-middle transition-colors",
  {
    variants: {
      striped: {
        true: "even:bg-[var(--row-stripe-bg)]",
        false: "",
      },
      hoverable: {
        true: "hover:bg-[var(--row-hover-bg)]",
        false: "",
      },
      selected: {
        true: "bg-[var(--color-interaction)]/10",
        false: "",
      },
    },
    defaultVariants: {
      striped: false,
      hoverable: false,
      selected: false,
    },
  }
);
