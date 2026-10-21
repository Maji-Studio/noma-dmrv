// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemovalTemplateSetupPage } from "./index";
import { setupData } from "./test-support";

const ACTIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OLD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const state = vi.hoisted(() => ({ read: [] as string[], mounts: [] as string[] }));

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: ACTIVE, isLoading: false, isResolving: false }) }));
vi.mock("@/hooks/use-removal-template-setup", () => ({
  useRemovalTemplateSetup: (facilityId: string) => {
    state.read.push(facilityId);
    return { data: setupData(), isError: false, isFetching: false, refetch: vi.fn() };
  },
}));
vi.mock("./setup-flow", () => ({
  RemovalTemplateSetupFlow: ({ facilityId }: { facilityId: string }) => <div>{`flow for ${facilityId}`}</div>,
}));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));

afterEach(() => { cleanup(); state.read.length = 0; });

describe("RemovalTemplateSetupPage", () => {
  it("reads and writes the live facility, not the one in the link", () => {
    render(<RemovalTemplateSetupPage facilityParam={OLD} />);
    expect(new Set(state.read)).toEqual(new Set([ACTIVE]));
    expect(screen.getByText(`flow for ${ACTIVE}`)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toContain(ACTIVE);
  });
});
