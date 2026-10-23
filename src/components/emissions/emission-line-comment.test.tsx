// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { LOCKED_FIELD_MESSAGE } from "@/lib/save-refusal";
import { makeLine } from "./emission-line-test-fixtures";
import { LineComment } from "./emission-line-comment";

const mocks = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@/hooks/use-emission-line-comments", () => ({
  useSetEmissionLineComment: () => ({ isPending: false, mutateAsync: mocks.set }),
  useDeleteEmissionLineComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

const SCOPE = { facilityId: "fac", creditBatchId: "cb" };
const COMMENT = { id: "c1", body: "Saved words", version: 3, updatedAt: new Date(), updatedBy: "u1" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderEditor(withComment = false, onEditingChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LineComment line={makeLine(withComment ? { comment: COMMENT } : {})} scope={SCOPE} editing onEditingChange={onEditingChange} />
    </QueryClientProvider>,
  );
  return onEditingChange;
}
const box = () => screen.getByRole("textbox", { name: "Comment" });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save comment" }));

describe("line comment editor", () => {
  it("saves the trimmed words and closes", async () => {
    mocks.set.mockResolvedValue({});
    const onEditingChange = renderEditor();
    fireEvent.change(box(), { target: { value: "  Checked  " } });
    save();
    await waitFor(() => expect(onEditingChange).toHaveBeenCalledWith(false));
    expect(mocks.set).toHaveBeenCalledWith({ facilityId: "fac", creditBatchId: "cb", componentId: "line-1", body: "Checked" });
  });

  it("asks for words at the field and sends nothing", async () => {
    renderEditor();
    save();
    expect(await screen.findByText("Enter a comment.")).toBeTruthy();
    expect(box().getAttribute("aria-invalid")).toBe("true");
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("sends one save when submitted twice in the same tick", async () => {
    let finish: (value: object) => void = () => undefined;
    mocks.set.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onEditingChange = renderEditor();
    fireEvent.change(box(), { target: { value: "Once" } });
    const form = box().closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.set).toHaveBeenCalledTimes(1));
    finish({});
    await waitFor(() => expect(onEditingChange).toHaveBeenCalledWith(false));
    expect(mocks.set).toHaveBeenCalledTimes(1);
  });

  it("lands a refusal that names the body at the field, with no footer", async () => {
    // The issue path the server sends for a rejected comment body (setEmissionLineCommentSchema).
    mocks.set.mockRejectedValue(new ActionError({
      error: "Not saved.",
      code: "validation_failed",
      issues: [{ path: ["body"], code: "too_big", message: "Use 4,000 characters or fewer." }],
    }));
    renderEditor();
    fireEvent.change(box(), { target: { value: "Words" } });
    save();
    expect(await screen.findByText("Use 4,000 characters or fewer.")).toBeTruthy();
    expect(document.getElementById("comment-line-1-error")?.textContent).toBe("Use 4,000 characters or fewer.");
    expect(screen.queryByText("Not saved.")).toBeNull();
  });

  it("keeps the footer when the refusal names no field", async () => {
    mocks.set.mockRejectedValue(new Error("boom"));
    renderEditor();
    fireEvent.change(box(), { target: { value: "Words" } });
    save();
    expect(await screen.findByText("boom")).toBeTruthy();
  });

  // Form contract test, not a real server shape: the comment write takes no
  // lock, so no lock issue names the body today.
  it("puts the words back and says it is locked when a lock names the body", async () => {
    mocks.set.mockRejectedValue(new ActionError({
      error: "Locked.",
      code: "certification_locked",
      issues: [{ path: ["body"], code: "certification_locked", message: "Locked." }],
    }));
    renderEditor(true);
    fireEvent.change(box(), { target: { value: "Changed words" } });
    save();
    expect(await screen.findByText(LOCKED_FIELD_MESSAGE)).toBeTruthy();
    expect(box()).toHaveProperty("value", "Saved words");
  });
});
