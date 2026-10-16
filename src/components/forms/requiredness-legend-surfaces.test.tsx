// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EntitySideSheet } from "@/components/ui/entity-side-sheet";
import { Modal } from "@/components/ui/modal";
import { FormField } from "./form-field";
import { RequirednessLegendHint } from "./requiredness-legend";
import {
  RequirednessLegendContext,
  RequirednessLegendProvider,
} from "./requiredness-legend-context";
import { SectionLabel } from "./section-label";

const LEGEND = { name: "What the red asterisk and CERT chip mean" };

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(cleanup);

function cert(id: string) {
  return (
    <FormField key={id} id={id} label={id} certifyRequired>
      <input id={id} />
    </FormField>
  );
}

function Scope({ children }: { children: ReactNode }) {
  return (
    <RequirednessLegendProvider>
      <RequirednessLegendHint />
      {children}
    </RequirednessLegendProvider>
  );
}

describe("requiredness legend, real InfoHint", () => {
  it("describes the trigger with both lines kept apart", () => {
    const markup = renderToStaticMarkup(
      <RequirednessLegendContext.Provider value={{ certFieldCount: 1, countCertField: () => {} }}>
        <RequirednessLegendHint />
      </RequirednessLegendContext.Provider>,
    );
    expect(markup).toContain(
      'aria-description="Red asterisk: Required. You cannot save until it is filled in. CERT chip: Required for certification. You can save without it."',
    );
  });
});

describe("requiredness legend counting", () => {
  it("stays while one of two CERT fields remains", () => {
    const view = render(<Scope>{[cert("a"), cert("b")]}</Scope>);
    expect(screen.getByRole("button", LEGEND)).toBeTruthy();
    view.rerender(<Scope>{[cert("a")]}</Scope>);
    expect(screen.getByRole("button", LEGEND)).toBeTruthy();
    view.rerender(<Scope>{[]}</Scope>);
    expect(screen.queryByRole("button", LEGEND)).toBeNull();
  });

  it("counts a CERT section label", () => {
    render(
      <Scope>
        <SectionLabel certifyRequired>Readings</SectionLabel>
      </Scope>,
    );
    expect(screen.getByRole("button", LEGEND)).toBeTruthy();
  });

  it("counts once under StrictMode double effects", () => {
    const view = render(
      <StrictMode>
        <Scope>{[cert("a")]}</Scope>
      </StrictMode>,
    );
    expect(screen.getByRole("button", LEGEND)).toBeTruthy();
    view.rerender(
      <StrictMode>
        <Scope>{[]}</Scope>
      </StrictMode>,
    );
    expect(screen.queryByRole("button", LEGEND)).toBeNull();
  });
});

describe("requiredness legend surfaces", () => {
  it("a chip inside a Modal does not light the surrounding hint", () => {
    render(
      <Scope>
        <Modal isOpen onClose={() => {}} ariaLabel="Quick add">
          {cert("inside")}
        </Modal>
      </Scope>,
    );
    expect(screen.getByLabelText("inside", { selector: "input" })).toBeTruthy();
    expect(screen.queryByRole("button", LEGEND)).toBeNull();
  });

  function sheet(mode: "view" | "edit") {
    return (
      <EntitySideSheet
        open
        onOpenChange={() => {}}
        mode={mode}
        onModeChange={() => {}}
        title="Feedstock"
      >
        {cert("mass")}
      </EntitySideSheet>
    );
  }

  it("shows the hint in a sheet's edit mode only", () => {
    const view = render(sheet("edit"));
    expect(screen.getByRole("button", LEGEND)).toBeTruthy();
    view.rerender(sheet("view"));
    expect(screen.queryByRole("button", LEGEND)).toBeNull();
  });
});
