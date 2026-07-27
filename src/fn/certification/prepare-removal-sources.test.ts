import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import type {
  CandidateDocument,
  CandidateDocumentsForRemoval,
} from "./sources";

vi.mock("@/lib/auth/server", () => ({
  requireOrgRole: vi.fn(),
}));

vi.mock("./sources", () => ({
  loadCandidateDocumentsForRemovalForUser: vi.fn(),
  mirrorDocumentToSourceForUser: vi.fn(),
}));

import { requireOrgRole } from "@/lib/auth/server";
import {
  loadCandidateDocumentsForRemovalForUser,
  mirrorDocumentToSourceForUser,
} from "./sources";
import { prepareRemovalSourcesForUser } from "./prepare-removal-sources";

const ORG_CONTEXT = {} as OrgContext;
const REMOVAL_ID = "00000000-0000-4000-8000-000000000001";

function candidate(
  id: string,
  fileName: string,
  prepared: boolean,
): CandidateDocument {
  return {
    document: { id, fileName },
    lineageEntity: {
      entityType: "credit_batch",
      entityId: "batch-id",
      entityLabel: "Credit batch CB-1",
    },
    mirror: prepared
      ? {
          externalDocumentId: `src-${id}`,
          isPublic: false,
          mirroredAt: new Date("2026-07-01T00:00:00Z"),
        }
      : null,
  } as CandidateDocument;
}

function candidateSet(
  candidates: CandidateDocument[],
): CandidateDocumentsForRemoval {
  return {
    removalId: REMOVAL_ID,
    facilityId: "facility-id",
    candidates,
    mirroredExternalIds: candidates.flatMap((item) =>
      item.mirror ? [item.mirror.externalDocumentId] : [],
    ),
    hasMapping: true,
  };
}

describe("prepareRemovalSourcesForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prepares every missing candidate and skips existing mirrors", async () => {
    vi.mocked(loadCandidateDocumentsForRemovalForUser).mockResolvedValue(
      candidateSet([
        candidate("already-ready", "ready.pdf", true),
        candidate("missing-a", "a.pdf", false),
        candidate("missing-b", "b.pdf", false),
      ]),
    );
    vi.mocked(mirrorDocumentToSourceForUser).mockResolvedValue({
      externalDocumentId: "src-new",
      isPublic: false,
      recovered: false,
    });

    await expect(
      prepareRemovalSourcesForUser(ORG_CONTEXT, REMOVAL_ID),
    ).resolves.toEqual({
      total: 3,
      ready: 3,
      newlyPrepared: 2,
    });

    expect(requireOrgRole).toHaveBeenCalledWith(ORG_CONTEXT, "admin");
    expect(mirrorDocumentToSourceForUser).toHaveBeenCalledTimes(2);
    expect(mirrorDocumentToSourceForUser).toHaveBeenNthCalledWith(
      1,
      ORG_CONTEXT,
      { removalId: REMOVAL_ID, documentId: "missing-a" },
      { enforceRemovalLifecycle: true },
    );
    expect(mirrorDocumentToSourceForUser).toHaveBeenNthCalledWith(
      2,
      ORG_CONTEXT,
      { removalId: REMOVAL_ID, documentId: "missing-b" },
      { enforceRemovalLifecycle: true },
    );
  });

  it("attempts all missing files before returning one workflow error", async () => {
    vi.mocked(loadCandidateDocumentsForRemovalForUser).mockResolvedValue(
      candidateSet([
        candidate("missing-a", "a.pdf", false),
        candidate("missing-b", "b.pdf", false),
      ]),
    );
    vi.mocked(mirrorDocumentToSourceForUser).mockImplementation(
      async (_orgCtx, input) => {
        if (input.documentId === "missing-a") {
          throw new Error("upload failed");
        }
        return {
          externalDocumentId: "src-missing-b",
          isPublic: false,
          recovered: false,
        };
      },
    );

    await expect(
      prepareRemovalSourcesForUser(ORG_CONTEXT, REMOVAL_ID),
    ).rejects.toThrow(
      "Could not prepare all supporting sources:\na.pdf: upload failed",
    );
    expect(mirrorDocumentToSourceForUser).toHaveBeenCalledTimes(2);
  });
});
