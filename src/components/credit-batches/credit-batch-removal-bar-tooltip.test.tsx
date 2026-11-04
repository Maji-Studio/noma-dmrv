// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemovalBarGroup, RemovalBarSlice } from "@/lib/credit-batches/removal-bar";
import { DetailedRemovalBar, segmentFacts } from "./credit-batch-removal-bar";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC" }) }));

const slice = (applicationId: string, deliveryCode: string, removalId: string | null): RemovalBarSlice =>
  ({ applicationId, deliveryCode, destinationLabel: "Kanyama field", applicationCode: "AP-26-004", applicationDate: "2026-10-12", dryKg: 420, removalId }) as unknown as RemovalBarSlice;

const GROUPS = [
  {
    id: "rem-1", segment: "submitted", dryKg: 420,
    removal: { id: "rem-1", code: "RM-26-001", status: { kind: "submitted", label: "Submitted", value: "submitted" }, phase: "submitted" },
    parts: [{ id: "a1", slice: slice("a1", "DL-26-031", "rem-1"), dryKg: 420 }],
  },
  {
    id: "not-in-removal", segment: "notInRemoval", dryKg: 420, removal: null,
    parts: [{ id: "a2", slice: slice("a2", "DL-26-032", null), dryKg: 420 }],
  },
] as unknown as RemovalBarGroup[];

const FIRST = "DL-26-031 to Kanyama field, AP-26-004, applied Oct 12, 2026, 0.42 t dry, In RM-26-001";
const SECOND = "DL-26-032 to Kanyama field, AP-26-004, applied Oct 12, 2026, 0.42 t dry, Not in a Removal";

afterEach(cleanup);

describe("DetailedRemovalBar segments", () => {
  it("names each segment once and drops the native title", () => {
    const { container } = render(<DetailedRemovalBar groups={GROUPS} facilityId="facility-1" />);
    expect(screen.getByRole("link", { name: FIRST })).toBeTruthy();
    expect(screen.getByRole("button", { name: SECOND })).toBeTruthy();
    expect(container.querySelectorAll("[title]")).toHaveLength(0);
    expect(screen.getByRole("group", { name: "RM-26-001" }).closest("[aria-hidden]")).toBeNull();
  });

  it("states the facts the tooltip shows", () => {
    expect(segmentFacts(GROUPS[1].parts[0].slice, 420, null)).toEqual({
      title: "DL-26-032 to Kanyama field",
      meta: "AP-26-004, applied Oct 12, 2026",
      mass: "0.42 t dry",
      membership: "Not in a Removal",
    });
  });

  it("opens on hover with the code, date, dry mass and Removal", async () => {
    render(<DetailedRemovalBar groups={GROUPS} facilityId="facility-1" />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: FIRST }));
    fireEvent.mouseMove(screen.getByRole("link", { name: FIRST }));
    const tip = await screen.findByText("In RM-26-001");
    expect(tip.parentElement?.textContent).toContain("DL-26-031 to Kanyama field");
    expect(tip.parentElement?.textContent).toContain("AP-26-004, applied Oct 12, 2026");
    expect(tip.parentElement?.textContent).toContain("0.42 t dry");
  });

  it("opens on a tap, stays open, and a second tap closes it", async () => {
    render(<DetailedRemovalBar groups={GROUPS} facilityId="facility-1" />);
    const segment = screen.getByRole("button", { name: SECOND });
    fireEvent.pointerDown(segment, { pointerType: "touch" });
    fireEvent.click(segment);
    expect(await screen.findByText("Not in a Removal")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByText("Not in a Removal")).toBeTruthy();
    fireEvent.click(segment);
    await waitFor(() => expect(screen.queryByText("Not in a Removal")).toBeNull());
  });

  it("does not follow the link on a touch tap, and follows it on a mouse click", () => {
    render(<DetailedRemovalBar groups={GROUPS} facilityId="facility-1" />);
    const link = screen.getByRole("link", { name: FIRST });
    fireEvent.pointerDown(link, { pointerType: "touch" });
    expect(fireEvent.click(link, { detail: 1 })).toBe(false);
    fireEvent.pointerDown(link, { pointerType: "mouse" });
    expect(fireEvent.click(link, { detail: 1 })).toBe(true);
  });

  it("follows the link on Enter after a tap, since a keyboard click has detail 0 and the tap is spent", () => {
    render(<DetailedRemovalBar groups={GROUPS} facilityId="facility-1" />);
    const link = screen.getByRole("link", { name: FIRST });
    fireEvent.pointerDown(link, { pointerType: "touch" });
    expect(fireEvent.click(link, { detail: 0 })).toBe(true);
    fireEvent.pointerDown(link, { pointerType: "touch" });
    expect(fireEvent.click(link, { detail: 1 })).toBe(false);
    expect(fireEvent.click(link, { detail: 0 })).toBe(true);
  });
});
