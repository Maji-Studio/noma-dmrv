import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LOAD_FAILED, MISSING_VALUE } from "@/lib/copy-utils";

const query = vi.hoisted(() => ({
  result: { data: undefined as unknown, isPending: false, isError: false },
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
    query.result = { data: undefined, isPending: true, isError: false };

    expect(render(null)).toContain(MISSING_VALUE.notSet);
  });

  it("shows a loading skeleton instead of claiming the lookup failed", () => {
    query.result = { data: undefined, isPending: true, isError: false };

    const markup = render("bin-1");

    expect(markup).toContain("animate-skeleton");
    expect(markup).not.toContain("Record not found");
  });

  it("says a settled empty lookup found no record", () => {
    query.result = { data: null, isPending: false, isError: false };

    expect(render("bin-1")).toContain("Record not found");
  });

  it("says a failed lookup could not load instead of claiming no record", () => {
    query.result = { data: undefined, isPending: false, isError: true };

    const markup = render("bin-1");

    expect(markup).toContain(LOAD_FAILED);
    expect(markup).not.toContain("Record not found");
  });

  it("keeps a cached name when a refetch fails", () => {
    query.result = {
      data: { name: "North bin", code: "BIN-1" },
      isPending: false,
      isError: true,
    };

    expect(render("bin-1")).toContain("North bin");
  });

  it("renders the resolved name", () => {
    query.result = {
      data: { name: "North bin", code: "BIN-1" },
      isPending: false,
      isError: false,
    };

    expect(render("bin-1")).toContain("North bin");
  });

  it("falls back to the entity code when it has no name", () => {
    query.result = { data: { name: "", code: "BIN-1" }, isPending: false, isError: false };

    expect(render("bin-1")).toContain("BIN-1");
  });
});
