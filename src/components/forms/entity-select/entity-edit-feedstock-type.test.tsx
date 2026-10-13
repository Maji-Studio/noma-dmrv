// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FeedstockType } from "@/db/schema";
import { FeedstockTypeEditFormDialog } from "./entity-edit-forms";

vi.mock("@/hooks/use-feedstock-types", () => ({
  useUpdateFeedstockType: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: null }) }));
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useFacilityCertifierSummary: () => ({ data: null }),
}));
afterEach(cleanup);

const record: FeedstockType = {
  id: "11111111-1111-4111-8111-111111111111", organizationId: "org", code: "FT-1",
  name: "Compost", category: "compost", usage: "blend", version: 1,
  description: null, registryUrl: null, isometricFeedstockTypeId: null,
  archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
};

it("guards dirty Cancel in the real feedstock type form and preserves the draft when keeping edits", async () => {
  const close = vi.fn();
  render(<FeedstockTypeEditFormDialog record={record} isOpen onClose={close} />);
  const name = screen.getByRole("textbox", { name: /^Name/ });
  fireEvent.change(name, { target: { value: "Revised compost" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect((name as HTMLInputElement).value).toBe("Revised compost");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
  expect(close).toHaveBeenCalledOnce();
});
