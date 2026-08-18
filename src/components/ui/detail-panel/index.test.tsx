import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { DetailField, DetailSpine } from "./index";

const EMPTY_INK = "--color-text-tertiary";
const PRESENT_INK = "--color-text-primary";

describe("DetailField empty contract", () => {
  it("defaults a blank value to the operator-omission token", () => {
    for (const value of [null, undefined, ""]) {
      const markup = renderToStaticMarkup(
        <DetailField label="Distance" value={value} />,
      );

      expect(markup).toContain(MISSING_VALUE.notRecorded);
    }
  });

  it("renders the situation the caller declares", () => {
    const markup = renderToStaticMarkup(
      <DetailField label="Blend" value={null} emptySituation="notApplicable" />,
    );

    expect(markup).toContain(MISSING_VALUE.notApplicable);
    expect(markup).not.toContain(MISSING_VALUE.notRecorded);
  });

  it("names the blocked situation the trace view used to invent", () => {
    const markup = renderToStaticMarkup(
      <DetailField
        label="Compilation hash"
        value={null}
        emptySituation="notYetComputed"
      />,
    );

    expect(markup).toContain(MISSING_VALUE.notYetComputed);
  });

  it("gives every placeholder the same quieter treatment, marked for tests", () => {
    const markup = renderToStaticMarkup(
      <DetailField label="Distance" value={null} />,
    );

    expect(markup).toContain(EMPTY_INK);
    expect(markup).toContain("font-normal");
    expect(markup).toContain('data-empty="true"');
    expect(markup).not.toContain(PRESENT_INK);
  });

  it("dims a token the caller rendered itself, not just a blank value", () => {
    const markup = renderToStaticMarkup(
      <DetailField label="Source bin" value={MISSING_VALUE.notSet} />,
    );

    expect(markup).toContain(EMPTY_INK);
    expect(markup).toContain('data-empty="true"');
  });

  it("leaves real values at full strength", () => {
    const markup = renderToStaticMarkup(
      <DetailField label="Distance" value="25 km" />,
    );

    expect(markup).toContain(PRESENT_INK);
    expect(markup).toContain("font-medium");
    expect(markup).not.toContain("data-empty");
  });

  it("keeps a measured zero out of the placeholder treatment", () => {
    const markup = renderToStaticMarkup(
      <DetailField label="Distance" value="0 km" />,
    );

    expect(markup).toContain(PRESENT_INK);
    expect(markup).not.toContain("data-empty");
  });

  it("passes the contract through the sections config", () => {
    const markup = renderToStaticMarkup(
      <DetailSpine
        sections={[
          {
            title: "Blend",
            fields: [
              {
                label: "Amendment",
                value: null,
                emptySituation: "notApplicable",
              },
            ],
          },
        ]}
      />,
    );

    expect(markup).toContain(MISSING_VALUE.notApplicable);
    expect(markup).toContain('data-empty="true"');
  });
});

describe("DetailField certification status", () => {
  it("renders present saved values with the satisfied treatment", () => {
    const markup = renderToStaticMarkup(
      <DetailField label="Distance" value="25 km" certifyRequired />,
    );

    expect(markup).toContain("--st-ok-border");
  });

  it("renders absent saved values with the missing treatment", () => {
    const markup = renderToStaticMarkup(
      <DetailField label="Distance" value={null} certifyRequired />,
    );

    expect(markup).toContain("--st-wait-border");
  });

  it.each(Object.values(MISSING_VALUE))(
    "treats a formatted fallback as missing rather than satisfied",
    (value) => {
      const markup = renderToStaticMarkup(
        <DetailField label="Distance" value={value} certifyRequired />,
      );

      expect(markup).toContain("--st-wait-border");
      expect(markup).not.toContain("--st-ok-border");
    },
  );

  it.each(["notRecorded", "notAvailable", "notYetComputed"] as const)(
    "never reads a declared %s field as satisfied",
    (situation) => {
      const markup = renderToStaticMarkup(
        <DetailField
          label="Distance"
          value={null}
          emptySituation={situation}
          certifyRequired
        />,
      );

      expect(markup).toContain("--st-wait-border");
      expect(markup).not.toContain("--st-ok-border");
    },
  );

  // The regression: presence used to be inferred from the string the field
  // ended up rendering, so any off-vocabulary placeholder was truthy and put a
  // green "satisfied" chip over a missing certification field. Callers that
  // cannot express absence through `value` say so with `valuePresent`.
  it("does not read an off-vocabulary placeholder as satisfied", () => {
    const markup = renderToStaticMarkup(
      <DetailField
        label="Feedstock"
        value="Unassigned"
        valuePresent={false}
        certifyRequired
      />,
    );

    expect(markup).toContain("--st-wait-border");
    expect(markup).not.toContain("--st-ok-border");
    expect(markup).toContain('data-empty="true"');
  });

  it("does not read a rendered node as satisfied when the caller says it is absent", () => {
    const markup = renderToStaticMarkup(
      <DetailField
        label="Source bin"
        value={<span>Loading</span>}
        valuePresent={false}
        certifyRequired
      />,
    );

    expect(markup).toContain("--st-wait-border");
    expect(markup).not.toContain("--st-ok-border");
  });

  it("accepts an explicit present signal for values it cannot read", () => {
    const markup = renderToStaticMarkup(
      <DetailField
        label="Source bin"
        value={<span>North bin</span>}
        valuePresent
        certifyRequired
      />,
    );

    expect(markup).toContain("--st-ok-border");
    expect(markup).not.toContain("--st-wait-border");
  });

  it("accepts an explicit composite-requirement override", () => {
    const markup = renderToStaticMarkup(
      <DetailField
        label="Evidence"
        value="File attached"
        certifyRequired
        certifyStatus="missing"
      />,
    );

    expect(markup).toContain("--st-wait-border");
    expect(markup).not.toContain("--st-ok-border");
  });
});

describe("DetailSpine", () => {
  it("renders a contiguous passive step rail with shared spine chrome", () => {
    const markup = renderToStaticMarkup(
      <DetailSpine
        numbered
        sections={[
          { title: "First", fields: [{ label: "A", value: "One" }] },
          { title: "Second", fields: [{ label: "B", value: "Two" }] },
        ]}
      />,
    );

    expect(markup).toMatch(/>1<\/span>/);
    expect(markup).toMatch(/>2<\/span>/);
    expect(markup.match(/bottom-\[-16px\]/g)).toHaveLength(1);
    expect(markup).not.toContain("aria-checked");
  });

  it("preserves responsive detail rows and extension content", () => {
    const markup = renderToStaticMarkup(
      <DetailSpine
        numbered
        sections={[
          {
            title: "Details",
            fields: [
              { label: "A", value: "One" },
              { label: "B", value: "Two" },
              { label: "C", value: "Three" },
            ],
            content: <div>Extension content</div>,
          },
        ]}
      />,
    );

    expect(markup.match(/sm:flex-row/g)).toHaveLength(2);
    expect(markup).toContain("Extension content");
  });
});
