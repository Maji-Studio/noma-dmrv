// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { cn } from "@/lib/utils"
import { buttonVariants } from "./index"

const PREFIX =
  "inline-flex items-center justify-center whitespace-nowrap label-button transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] disabled:pointer-events-none disabled:opacity-40 cursor-pointer rounded-none border border-[var(--color-border-primary)] bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-medium)] active:bg-[var(--color-surface-light)]"

// Exact merged classes the nine non-icon size and width combinations produced
// before the icon width fix (captured from origin/staging).
const NON_ICON_CLASSES: Record<string, string> = {
  "default/default": `${PREFIX} h-[40px] px-16 gap-10 w-auto`,
  "default/square": `${PREFIX} h-[40px] gap-10 aspect-square p-0`,
  "default/full": `${PREFIX} h-[40px] px-16 gap-10 w-full`,
  "small/default": `${PREFIX} h-[32px] px-12 gap-8 text-[length:var(--text-xs)] w-auto`,
  "small/square": `${PREFIX} h-[32px] gap-8 text-[length:var(--text-xs)] aspect-square p-0`,
  "small/full": `${PREFIX} h-[32px] px-12 gap-8 text-[length:var(--text-xs)] w-full`,
  "large/default": `${PREFIX} h-[48px] px-20 xl:h-[60px] xl:px-24 gap-12 w-auto`,
  "large/square": `${PREFIX} h-[48px] xl:h-[60px] xl:px-24 gap-12 aspect-square p-0`,
  "large/full": `${PREFIX} h-[48px] px-20 xl:h-[60px] xl:px-24 gap-12 w-full`,
}

const merged = (size: "default" | "small" | "large" | "icon", width?: "default" | "square" | "full") =>
  cn(buttonVariants({ size, width }))

describe("buttonVariants size x width", () => {
  it("makes the icon size a 32px square without a width prop", () => {
    const list = merged("icon").split(" ")
    expect(list).toContain("h-[32px]")
    expect(list).toContain("w-[32px]")
    expect(list).not.toContain("w-auto")
  })

  it("keeps explicit square and full widths on the icon size", () => {
    expect(merged("icon", "square").split(" ")).toContain("aspect-square")
    expect(merged("icon", "square").split(" ")).not.toContain("w-auto")
    expect(merged("icon", "full").split(" ")).toContain("w-full")
    expect(merged("icon", "full").split(" ")).not.toContain("w-auto")
  })

  it.each(Object.entries(NON_ICON_CLASSES))("non-icon %s is unchanged", (key, expected) => {
    const [size, width] = key.split("/") as ["default" | "small" | "large", "default" | "square" | "full"]
    expect(merged(size, width)).toBe(expected)
  })

  it("treats an omitted width like the default width", () => {
    for (const size of ["default", "small", "large"] as const) {
      expect(merged(size)).toBe(NON_ICON_CLASSES[`${size}/default`])
    }
  })
})
