import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AffectedStockPreview } from "@/types/output-stock";
import { AffectedBinNotices } from "./affected-bin-notices";

const preview = {
  lane: "biochar",
  storageLocationId: "bin-1",
  binName: "Output bin B2",
  discrepancySolidsKg: 0,
  blockingMessage: null,
} as AffectedStockPreview;

describe("AffectedBinNotices", () => {
  it("renders nothing while the bin needs no attention", () => {
    expect(renderToStaticMarkup(<AffectedBinNotices preview={preview} />)).toBe("");
    expect(renderToStaticMarkup(<AffectedBinNotices preview={undefined} />)).toBe("");
  });

  it("announces a refusal unless the field already shows it", () => {
    const blocked = { ...preview, blockingMessage: "Not enough dry biochar in the selected bin." };
    const html = renderToStaticMarkup(<AffectedBinNotices preview={blocked} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Not enough dry biochar in the selected bin.");
    expect(renderToStaticMarkup(<AffectedBinNotices preview={blocked} hideBlockingMessage />)).toBe("");
  });

  it("keeps blockers and discrepancies visible even when the message is shown elsewhere", () => {
    const html = renderToStaticMarkup(
      <AffectedBinNotices
        hideBlockingMessage
        preview={{
          ...preview,
          blockingMessage: "Blocked",
          discrepancySolidsKg: 12,
          blockers: [
            { entity: "application", id: "app-1", code: "APP-1" },
            { entity: "binMovement", id: "mov-1", code: "MOV-1" },
          ],
        }}
      />,
    );
    expect(html).toContain("Count exceeds tracked solids by 12 kg. This discrepancy adds no stock.");
    expect(html).toContain('href="/applications?ids=app-1"');
    expect(html).toContain("MOV-1");
    expect(html).not.toContain("Blocked<");
  });
});
