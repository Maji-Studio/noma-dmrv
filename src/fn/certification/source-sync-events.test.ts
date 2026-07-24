import { describe, expect, it, vi } from "vitest";

vi.mock("./shared", () => ({
  appendSyncEventBestEffort: vi.fn().mockResolvedValue(undefined),
  ISOMETRIC_PROVIDER: "isometric",
  REMOVAL_ENTITY_TYPE: "removal",
}));

import { appendSyncEventBestEffort } from "./shared";
import { withSourceSyncEventOnFailure } from "./source-sync-events";

describe("withSourceSyncEventOnFailure", () => {
  it("records a source failure for both the document and its removal", async () => {
    const error = new Error("upload failed");

    await expect(
      withSourceSyncEventOnFailure(
        {
          organizationId: "org",
          userId: "user",
          orgRole: "admin",
          isPlatformAdmin: false,
        },
        {
          documentId: "document-id",
          removalId: "removal-id",
          operation: "source:upload",
          requestPayload: { externalId: "source-id" },
        },
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);

    expect(appendSyncEventBestEffort).toHaveBeenCalledTimes(2);
    expect(appendSyncEventBestEffort).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: "document",
        entityId: "document-id",
        status: "failed",
      }),
    );
    expect(appendSyncEventBestEffort).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: "removal",
        entityId: "removal-id",
        status: "failed",
        requestPayload: {
          externalId: "source-id",
          documentId: "document-id",
        },
      }),
    );
  });
});
