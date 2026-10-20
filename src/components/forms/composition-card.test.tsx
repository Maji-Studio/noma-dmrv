// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it } from "vitest";
import { CompositionCard } from "./composition-card";
import { DerivedHeadline } from "./derived-headline";

afterEach(cleanup);

function Block({ explanation = <p>Batch ledger</p> }: { explanation?: React.ReactNode }) {
  return (
    <CompositionCard
      title="Bin stock"
      hint="What the bin holds."
      headline={<DerivedHeadline label="Wet stock in bin, estimate" before="≈ 1,420" value="1,110 kg" sub="310 kg wet mass removed at 22.7% moisture" />}
      explanation={explanation}
      actions={<button type="button">Stock history</button>}
    >
      <p>Split bar</p>
      <p>Dry biochar in bin 540 → 135 kg</p>
    </CompositionCard>
  );
}

describe("CompositionCard", () => {
  it("shows caption, headline, picture, short lines and actions; the explanation waits behind the (i)", () => {
    render(<Block />);
    for (const text of ["Bin stock", "≈ 1,420", "1,110 kg", "310 kg wet mass removed", "Split bar", "Dry biochar in bin 540 → 135 kg", "Stock history"]) {
      expect(screen.getByText(new RegExp(text.replace(/[≈→.()]/g, "\\$&")))).toBeTruthy();
    }
    expect(screen.queryByText("Batch ledger")).toBeNull();
    expect(screen.queryByText(/Show calculation/)).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("opens the definition and the explanation from one (i) on a press, and closes on Escape", async () => {
    render(<Block />);
    const info = screen.getAllByRole("button", { name: "How bin stock is worked out" });
    expect(info).toHaveLength(1);
    expect(info[0].getAttribute("type")).toBe("button");
    expect(info[0].hasAttribute("data-presentation-control")).toBe(true);
    fireEvent.click(info[0]);
    expect(await screen.findByText("Batch ledger")).toBeTruthy();
    expect(screen.getByText("What the bin holds.")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await screen.findByRole("button", { name: "How bin stock is worked out" });
  });

  it("keeps the plain definition hint when there is no explanation", () => {
    render(<Block explanation={null} />);
    expect(screen.queryByRole("button", { name: "How bin stock is worked out" })).toBeNull();
    expect(screen.getByRole("button", { name: "About bin stock" })).toBeTruthy();
  });

  it("never submits or dirties the form when the (i) is pressed", () => {
    function Form() {
      const { formState } = useForm({ defaultValues: { mass: 100 } });
      return <form><output>{formState.isDirty ? "dirty" : "clean"}</output><Block /></form>;
    }
    const { container } = render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "How bin stock is worked out" }));
    expect(container.querySelector("output")?.textContent).toBe("clean");
  });
});

describe("DerivedHeadline", () => {
  it("leaves out a figure it cannot derive yet, keeping the reason when there is one", () => {
    const { container } = render(<DerivedHeadline label="Yield" value={null} />);
    expect(container.innerHTML).toBe("");
    cleanup();
    render(<DerivedHeadline label="Yield" value={null} sub="Needs a feedstock mass" />);
    expect(screen.getByText(/Yield/)).toBeTruthy();
    expect(screen.getByText(/Needs a feedstock mass/)).toBeTruthy();
    expect(screen.queryByText(/Not available/)).toBeNull();
  });
});
