// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reactor } from "@/db/schema/facilities";
import { fieldRefusal, RefusalParent } from "../../../tests/helpers/refusal-form-parent";
import { ReactorForm } from "./reactor-form";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const FALLBACK = "Reactor was not saved. Try again.";
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: FACILITY_ID }) }));

const saved = {
  id: "reactor", identifier: "Kiln 01", facilityId: FACILITY_ID, reactorType: "rotary-kiln", nominalThroughputTph: 3,
} as unknown as Reactor;

function renderRefused(refusal: unknown) {
  render(
    <RefusalParent refusal={refusal} fallback={FALLBACK}>
      {(props) => <ReactorForm reactor={saved} {...props} />}
    </RefusalParent>,
  );
  fireEvent.submit(screen.getByRole("textbox", { name: /^Identifier/ }).closest("form")!);
}

afterEach(cleanup);

describe("ReactorForm refused save", () => {
  it("shows a refusal of the server's nominalThroughputTph at the throughput field with no footer", async () => {
    renderRefused(fieldRefusal(["nominalThroughputTph"], "Too large"));
    await waitFor(() => expect(screen.getAllByText("Too large").length).toBeGreaterThan(0));
    expect(document.querySelector("#capacityTph-error")?.textContent).toContain("Too large");
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  it("shows an identifier refusal at the identifier field", async () => {
    renderRefused(fieldRefusal(["identifier"], "Identifier is taken"));
    await waitFor(() => expect(document.querySelector("#identifier-error")?.textContent).toContain("Identifier is taken"));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  it("keeps a refusal that names a field the form does not show in the footer", async () => {
    renderRefused(fieldRefusal(["specifications"], "Specifications are not valid"));
    await waitFor(() => expect(screen.getByTestId("footer").textContent).toBe("Specifications are not valid"));
  });

  it("keeps the caller's fallback for an error without issues", async () => {
    renderRefused(new Error("offline"));
    await waitFor(() => expect(screen.getByTestId("footer").textContent).toBe(FALLBACK));
  });
});
