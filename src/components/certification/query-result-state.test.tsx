import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueryResultState } from "./query-result-state";

describe("QueryResultState", () => {
  it("wraps loading and prioritizes it over an error and existing data", () => {
    const html = renderToStaticMarkup(
      <QueryResultState
        isLoading
        error={new Error("Failed")}
        data={{ label: "Ready" }}
        loadingMessage="Loading mapping…"
        errorMessage="Mapping unavailable."
        wrap={(children) => <section>{children}</section>}
      >
        {(data) => <span>{data.label}</span>}
      </QueryResultState>,
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
      <QueryResultState
        isLoading={false}
        error={error}
        data={data}
        loadingMessage="Loading mapping…"
        errorMessage="Mapping unavailable."
        wrap={(children) => <section>{children}</section>}
      >
        {(loaded) => <span>{loaded.label}</span>}
      </QueryResultState>,
    );
    expect(html).toBe(
      '<section><p class="body-small text-[var(--color-signal-red)]">Mapping unavailable.</p></section>',
    );
  });

  it("passes loaded data to children without the status wrapper", () => {
    const html = renderToStaticMarkup(
      <QueryResultState
        isLoading={false}
        error={null}
        data={{ label: "Ready" }}
        loadingMessage="Loading mapping…"
        errorMessage="Mapping unavailable."
        wrap={(children) => <section>{children}</section>}
      >
        {(data) => <span>{data.label}</span>}
      </QueryResultState>,
    );
    expect(html).toBe("<span>Ready</span>");
  });

  it.each([false, 0, "", null])(
    "passes a valid falsy result to children: %j",
    (data) => {
      const html = renderToStaticMarkup(
        <QueryResultState
          isLoading={false}
          error={null}
          data={data}
          loadingMessage="Loading mapping…"
          errorMessage="Mapping unavailable."
          wrap={(children) => <section>{children}</section>}
        >
          {(loaded) => {
            expect(loaded).toBe(data);
            return <span>Loaded</span>;
          }}
        </QueryResultState>,
      );
      expect(html).toBe("<span>Loaded</span>");
    },
  );
});
