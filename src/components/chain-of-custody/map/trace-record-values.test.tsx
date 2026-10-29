// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { batchModel } from "./trace-fixtures";
import { RecordValues } from "./trace-record-values";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

function withDetails(id: string, details: Array<{ label: string; value: string }>) {
  const model = batchModel();
  const record = { ...model.records.get(id)!, details };
  return { model, record };
}

it("shows a missing dry mass as Not recorded for a kind that carries one", () => {
  const { model, record } = withDetails("production-run:pr1", [{ label: "Biochar out", value: "Wet: 300 kg · Dry: Not recorded" }]);
  render(<RecordValues model={model} record={record} />);
  expect(screen.getByText("Dry")).toBeTruthy();
  expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
});

it("leaves the Dry figure out for an order, which has none", () => {
  const { model, record } = withDetails("delivery:dl1", [{ label: "Quantity", value: "Wet: 1,000 kg · Dry: Not recorded" }]);
  render(<RecordValues model={model} record={{ ...record, kind: "order" }} />);
  expect(screen.queryByText("Dry")).toBeNull();
});

it("collects only plain gaps into the note and keeps other tokens as rows", () => {
  const { model, record } = withDetails("production-run:pr1", [
    { label: "Operator", value: "Not recorded" },
    { label: "Reactor", value: "Not set" },
  ]);
  render(<RecordValues model={model} record={record} />);
  expect(screen.getByText("Not recorded: Operator")).toBeTruthy();
  expect(screen.getByText("Reactor")).toBeTruthy();
  expect(screen.getByText("Not set")).toBeTruthy();
});

it("links the full record with a real link", () => {
  const { model, record } = withDetails("application:ap1", []);
  render(<RecordValues model={model} record={record} />);
  expect(screen.getByRole("link", { name: /View full record/ }).getAttribute("href")).toBe(record.href);
});
