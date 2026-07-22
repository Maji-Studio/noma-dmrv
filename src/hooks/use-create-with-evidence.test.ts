import { describe, expect, it, vi } from "vitest";
import type { DeferredAttachment } from "@/hooks/use-deferred-attachments";
import {
  confirmCreateWithEvidenceClose,
  guardCreateWithEvidenceUpdate,
  runCreateWithEvidenceChoreography,
} from "@/hooks/use-create-with-evidence";

function attachmentWithStatus(
  status: DeferredAttachment["status"],
): Pick<DeferredAttachment, "status"> {
  return { status };
}

describe("runCreateWithEvidenceChoreography", () => {
  it("clears, runs the post-flush callback, closes, and toasts in order", async () => {
    const events: string[] = [];

    await runCreateWithEvidenceChoreography({
      input: "input",
      entityType: "sample",
      entityNoun: "Sample",
      executeCreate: async () => {
        events.push("create");
        return { entities: [{ id: "sample-1" }], result: "created" };
      },
      flushMany: async (entityType, entityIds) => {
        events.push(`flush:${entityType}:${entityIds.join(",")}`);
        return { ok: true, uploaded: [], failed: [] };
      },
      clearAttachments: () => events.push("clear"),
      retainCreatedEntityIds: (ids) => events.push(`retain:${ids.join(",")}`),
      setFlushing: (value) => events.push(`flushing:${value}`),
      setError: (message) => events.push(`error:${message}`),
      getCreateErrorMessage: () => "create failed",
      openEditOnFailure: () => events.push("open-edit"),
      closeOnSuccess: () => events.push("close"),
      onFlushSuccess: () => {
        events.push("post-flush");
      },
      onSuccess: () => events.push("toast"),
    });

    expect(events).toEqual([
      "error:null",
      "create",
      "retain:sample-1",
      "flushing:true",
      "flush:sample:sample-1",
      "clear",
      "post-flush",
      "close",
      "toast",
      "flushing:false",
    ]);
  });

  it("retains every created id and reopens edit with a pluralized partial-failure message", async () => {
    const retainedIds: string[][] = [];
    const setError = vi.fn<(message: string | null) => void>();
    const openEdit = vi.fn<(entity: { id: string }) => void>();
    const clear = vi.fn();

    await runCreateWithEvidenceChoreography({
      input: undefined,
      entityType: "feedstock",
      entityNoun: "Feedstock",
      executeCreate: async () => ({
        entities: [{ id: "feedstock-1" }, { id: "feedstock-2" }],
        result: undefined,
      }),
      flushMany: async () => ({
        ok: false,
        uploaded: [],
        failed: [
          {} as DeferredAttachment,
          {} as DeferredAttachment,
        ],
      }),
      clearAttachments: clear,
      retainCreatedEntityIds: (ids) => retainedIds.push(ids),
      setFlushing: vi.fn(),
      setError,
      getCreateErrorMessage: () => "create failed",
      openEditOnFailure: openEdit,
      closeOnSuccess: vi.fn(),
      onSuccess: vi.fn(),
    });

    expect(retainedIds).toEqual([["feedstock-1", "feedstock-2"]]);
    expect(openEdit).toHaveBeenCalledWith({ id: "feedstock-1" });
    expect(setError).toHaveBeenLastCalledWith(
      "Feedstock created, but 2 attachments failed to upload.",
    );
    expect(clear).not.toHaveBeenCalled();
  });
});

describe("guardCreateWithEvidenceUpdate", () => {
  it.each(["failed", "uploading"] as const)(
    "blocks an update when an attachment is %s",
    (status) => {
      const setError = vi.fn();
      const blocked = guardCreateWithEvidenceUpdate({
        attachments: [attachmentWithStatus(status)],
        message: "Resolve attachments",
        setError,
      });

      expect(blocked).toBe(true);
      expect(setError).toHaveBeenCalledWith("Resolve attachments");
    },
  );

  it("allows an update when every attachment is uploaded", () => {
    expect(
      guardCreateWithEvidenceUpdate({
        attachments: [attachmentWithStatus("uploaded")],
        message: "Resolve attachments",
        setError: vi.fn(),
      }),
    ).toBe(false);
  });
});

describe("confirmCreateWithEvidenceClose", () => {
  it("blocks closing while a flush is in progress", () => {
    const confirmDiscard = vi.fn(() => true);

    expect(
      confirmCreateWithEvidenceClose({
        isFlushing: true,
        isCreateMode: true,
        unsavedAttachmentCount: 1,
        confirmDiscard,
      }),
    ).toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it("prompts with the exact unsaved attachment count in create mode", () => {
    const confirmDiscard = vi.fn(() => true);

    expect(
      confirmCreateWithEvidenceClose({
        isFlushing: false,
        isCreateMode: true,
        unsavedAttachmentCount: 2,
        confirmDiscard,
      }),
    ).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledWith(
      "Discard 2 unsaved attachment(s)?",
    );
  });
});
