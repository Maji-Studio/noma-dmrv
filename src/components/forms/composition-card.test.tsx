// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      expect(screen.getByText(text, { exact: false })).toBeTruthy();
    }
    expect(screen.queryByText("Batch ledger")).toBeNull();
    expect(screen.queryByText(/Show calculation/)).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("opens the definition and the explanation from one (i) on a press, and closes on Escape", async () => {
    render(<Block />);
    const info = screen.getAllByRole("button", { name: "About Bin stock" });
    expect(info).toHaveLength(1);
    expect(info[0].hasAttribute("data-presentation-control")).toBe(true);
    fireEvent.click(info[0]);
    expect(await screen.findByText("Batch ledger")).toBeTruthy();
    expect(screen.getByText("What the bin holds.")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Batch ledger")).toBeNull());
    expect(screen.queryByText("What the bin holds.")).toBeNull();
  });

  it("returns focus to the (i) when Escape closes its panel", async () => {
    render(<Block />);
    const info = screen.getByRole("button", { name: "About Bin stock" });
    fireEvent.click(info);
    await screen.findByText("Batch ledger");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Batch ledger")).toBeNull());
    expect(document.activeElement).toBe(info);
  });

  it("opens from the keyboard", async () => {
    render(<Block />);
    const info = screen.getByRole("button", { name: "About Bin stock" });
    info.focus();
    fireEvent.keyDown(info, { key: "Enter" });
    fireEvent.keyUp(info, { key: "Enter" });
    expect(await screen.findByText("Batch ledger")).toBeTruthy();
  });

  it("keeps the plain definition hint when there is no explanation", () => {
    const { container } = render(<Block explanation={null} />);
    expect(container.querySelector("[data-explanation-info]")).toBeNull();
    expect(screen.getByRole("button", { name: "About Bin stock" })).toBeTruthy();
  });

  it("never submits or dirties the form when the (i) is pressed", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    function Form() {
      const { register, formState } = useForm({ defaultValues: { mass: "100" } });
      return <form onSubmit={onSubmit}><input aria-label="Mass" {...register("mass")} /><output>{formState.isDirty ? "dirty" : "clean"}</output><Block /></form>;
    }
    render(<Form />);
    const info = screen.getByRole("button", { name: "About Bin stock" });
    fireEvent.click(info);
    await screen.findByText("Batch ledger");
    fireEvent.keyDown(info, { key: "Enter" });
    fireEvent.keyUp(info, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("clean")).toBeTruthy();
    // The same output turns dirty on a real edit, so the assertion can fail.
    fireEvent.input(screen.getByLabelText("Mass"), { target: { value: "120" } });
    await waitFor(() => expect(screen.getByText("dirty")).toBeTruthy());
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
