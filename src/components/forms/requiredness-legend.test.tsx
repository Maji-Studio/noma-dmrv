import type { ReactElement } from "react";
import { act, create } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CERT_FIELD_STATUS_DESCRIPTION } from "@/components/ui/certification-field-tag";
import { FormField, REQUIRED_FIELD_TEXT } from "./form-field";
import { RequirednessLegendHint } from "./requiredness-legend";
import { RequirednessLegendProvider } from "./requiredness-legend-context";

vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ children, label }: { children: React.ReactNode; label: string }) => (
    <aside aria-label={label}>{children}</aside>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

function sheet(certifyRequired: boolean): ReactElement {
  return (
    <RequirednessLegendProvider>
      <header>
        <RequirednessLegendHint />
      </header>
      <FormField id="mass" label="Mass" required certifyRequired={certifyRequired}>
        <input id="mass" />
      </FormField>
    </RequirednessLegendProvider>
  );
}

function render(element: ReactElement) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(element);
  });
  return renderer;
}

describe("requiredness legend", () => {
  it("shows one hint on a form with CERT fields, worded from the existing strings", () => {
    const json = JSON.stringify(render(sheet(true)).toJSON());
    expect(json.match(/What the red asterisk and CERT chip mean/g)).toHaveLength(1);
    expect(json).toContain(`${REQUIRED_FIELD_TEXT}. You cannot save until it is filled in.`);
    expect(json).toContain(`${CERT_FIELD_STATUS_DESCRIPTION.neutral}. You can save without it.`);
  });

  it("shows nothing on a form without CERT fields", () => {
    const json = JSON.stringify(render(sheet(false)).toJSON());
    expect(json).not.toContain("What the red asterisk and CERT chip mean");
  });

  it("drops the hint when the last CERT field unmounts", () => {
    const renderer = render(sheet(true));
    act(() => renderer.update(sheet(false)));
    expect(JSON.stringify(renderer.toJSON())).not.toContain("CERT chip mean");
  });
});
