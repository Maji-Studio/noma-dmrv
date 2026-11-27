// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FailedRunEmissionTodos, FAILED_RUN_TODOS_ERROR_MESSAGE } from "./failed-run-emission-todos";

const hook = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-facility-failed-run-emission-todos", () => ({ useFacilityFailedRunEmissionTodos: () => hook.result }));

afterEach(cleanup);

describe("FailedRunEmissionTodos read states", () => {
  it("says the check failed and retries through refetch", () => {
    const refetch = vi.fn();
    hook.result = { isError: true, isFetching: false, data: undefined, refetch };
    render(<FailedRunEmissionTodos facilityId="fac-1" />);
    expect(screen.getByRole("status").textContent).toContain(FAILED_RUN_TODOS_ERROR_MESSAGE);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows nothing for a successful empty result", () => {
    hook.result = { isError: false, isFetching: false, data: [], refetch: vi.fn() };
    const { container } = render(<FailedRunEmissionTodos facilityId="fac-1" />);
    expect(container.innerHTML).toBe("");
  });
});
