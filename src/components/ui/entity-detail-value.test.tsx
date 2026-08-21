import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";

const query = vi.hoisted(() => ({
  result: { data: undefined as unknown, isPending: false },
}));

vi.mock("@/hooks/use-entities", () => ({
  useEntityById: () => query.result,
}));

const { EntityDetailValue } = await import("./entity-detail-value");

const render = (id: string | null) =>
  renderToStaticMarkup(
    <EntityDetailValue entityType="storageLocation" id={id} />,
  );

describe("EntityDetailValue", () => {
  it("reports an unchosen relation as not set", () => {
    query.result = { data: undefined, isPending: true };

    expect(render(null)).toContain(MISSING_VALUE.notSet);
  });

  it("shows a loading skeleton instead of claiming the lookup failed", () => {
    query.result = { data: undefined, isPending: true };

    const markup = render("bin-1");

    expect(markup).toContain("animate-skeleton");
    expect(markup).not.toContain(MISSING_VALUE.notAvailable);
  });

  it("reports a settled empty lookup as not available", () => {
    query.result = { data: null, isPending: false };

    expect(render("bin-1")).toContain(MISSING_VALUE.notAvailable);
  });

  it("renders the resolved name", () => {
    query.result = { data: { name: "North bin", code: "BIN-1" }, isPending: false };

    expect(render("bin-1")).toContain("North bin");
  });

  it("falls back to the entity code when it has no name", () => {
    query.result = { data: { name: "", code: "BIN-1" }, isPending: false };

    expect(render("bin-1")).toContain("BIN-1");
  });
});
