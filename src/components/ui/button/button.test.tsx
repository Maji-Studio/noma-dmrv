// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { buttonVariants } from "./index"

const SIZES = ["default", "small", "large", "icon"] as const
const WIDTHS = ["default", "square", "full"] as const

const classes = (size: (typeof SIZES)[number], width?: (typeof WIDTHS)[number]) =>
  buttonVariants({ size, width }).split(" ")

describe("buttonVariants size x width", () => {
  it("makes the icon size a 32px square without a width prop", () => {
    const list = classes("icon")
    expect(list).toContain("h-[32px]")
    expect(list).toContain("w-[32px]")
    expect(list).not.toContain("w-auto")
  })

  it("keeps w-auto for every text size at the default width", () => {
    for (const size of ["default", "small", "large"] as const) {
      expect(classes(size)).toContain("w-auto")
      expect(classes(size, "default")).toContain("w-auto")
    }
  })

  it("keeps explicit square and full widths for every size", () => {
    for (const size of SIZES) {
      expect(classes(size, "square")).toContain("aspect-square")
      expect(classes(size, "square")).not.toContain("w-auto")
      expect(classes(size, "full")).toContain("w-full")
      expect(classes(size, "full")).not.toContain("w-auto")
    }
  })

  it("leaves the non-icon class lists exactly as before", () => {
    // Snapshot of the size/width classes emitted before the fix.
    expect(classes("default")).toEqual(expect.arrayContaining(["h-[40px]", "px-16", "gap-10", "w-auto"]))
    expect(classes("small")).toEqual(expect.arrayContaining(["h-[32px]", "px-12", "gap-8", "w-auto"]))
    expect(classes("large")).toEqual(expect.arrayContaining(["h-[48px]", "px-20", "gap-12", "w-auto"]))
  })
})
