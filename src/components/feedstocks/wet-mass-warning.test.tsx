import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WetMassWarning } from "./wet-mass-warning";

describe("WetMassWarning", () => {
  it("shows the overage as concise field feedback and keeps justification entry", () => {
    const markup = renderToStaticMarkup(
      <WetMassWarning
        allocatedKg={1100}
        deliveredKg={1000}
        justificationRegister={{
          name: "overrideJustification",
          onChange: async () => undefined,
          onBlur: async () => undefined,
          ref: () => undefined,
        }}
      />,
    );

    expect(markup).toContain("100 kg over delivery. Add a justification.");
    expect(markup).toContain('id="overrideJustification-warning"');
    expect(markup).toContain(
      'aria-describedby="overrideJustification-warning"',
    );
    expect(markup).toContain('name="overrideJustification"');
    expect(markup).toContain("color-signal-orange-strong");
    expect(markup).not.toContain(
      "Allocated wet mass exceeds total delivery",
    );
  });
});
