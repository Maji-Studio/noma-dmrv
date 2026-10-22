// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SetupCreateSheet } from "./setup-create-sheet";

const drafts = vi.hoisted(() => ({ facility: vi.fn(), reactor: vi.fn() }));
vi.mock("@/hooks/use-facilities", () => ({ useCreateFacility: () => ({ startDraft: drafts.facility, isPending: false }) }));
vi.mock("@/hooks/use-reactors", () => ({ useCreateReactor: () => ({ startDraft: drafts.reactor, isPending: false }) }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ setFacilityId: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/facilities/facility-form", () => ({ FacilityForm: () => null }));
vi.mock("@/components/reactors/reactor-form", () => ({ ReactorForm: () => null }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("starts the selected draft on open and entity change, not on rerenders", () => {
  const onClose = vi.fn();
  const view = render(<SetupCreateSheet entity="facility" onClose={onClose} />);
  expect(drafts.facility).toHaveBeenCalledTimes(1);
  expect(drafts.reactor).not.toHaveBeenCalled();
  view.rerender(<SetupCreateSheet entity="facility" onClose={onClose} />);
  expect(drafts.facility).toHaveBeenCalledTimes(1);
  view.rerender(<SetupCreateSheet entity="reactor" onClose={onClose} />);
  expect(drafts.reactor).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<SetupCreateSheet entity="facility" onClose={onClose} />);
  expect(drafts.facility).toHaveBeenCalledTimes(2);
});
