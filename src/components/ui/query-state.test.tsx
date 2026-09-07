import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueryState } from "./query-state";

describe("QueryState", () => {
  it("wraps loading and prioritizes it over an error and existing data", () => {
    const html = renderToStaticMarkup(
      <QueryState
        isLoading
        error={new Error("Failed")}
        data={{ label: "Ready" }}
        loadingMessage="Loading mapping…"
        errorMessage="Mapping unavailable."
        wrap={(children) => <section>{children}</section>}
      >
        {(data) => <span>{data.label}</span>}
      </QueryState>,
    );
    expect(html).toBe(
      '<section><p class="body-small text-[var(--color-text-tertiary)]">Loading mapping…</p></section>',
    );
  });

  it.each([
    { error: new Error("Failed"), data: { label: "Ready" } },
    { error: null, data: undefined },
  ])("renders an error for failed or missing data: %j", ({ error, data }) => {
    const html = renderToStaticMarkup(
      <QueryState
        isLoading={false}
        error={error}
        data={data}
        loadingMessage="Loading mapping…"
        errorMessage="Mapping unavailable."
        wrap={(children) => <section>{children}</section>}
      >
        {(loaded) => <span>{loaded.label}</span>}
      </QueryState>,
    );
    expect(html).toBe(
      '<section><p class="body-small text-[var(--color-signal-red)]">Mapping unavailable.</p></section>',
    );
  });

  it("passes loaded data to children without the status wrapper", () => {
    const html = renderToStaticMarkup(
      <QueryState
        isLoading={false}
        error={null}
        data={{ label: "Ready" }}
        loadingMessage="Loading mapping…"
        errorMessage="Mapping unavailable."
        wrap={(children) => <section>{children}</section>}
      >
        {(data) => <span>{data.label}</span>}
      </QueryState>,
    );
    expect(html).toBe("<span>Ready</span>");
  });
});
