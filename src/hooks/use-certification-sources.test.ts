import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type {
  CandidateDocumentsForRemoval,
  MirrorResult,
} from "@/fn/certification";
import {
  applyConfirmedSourceMapping,
  reconcileCandidateSourcesAfterFailure,
} from "./use-certification-sources";

function candidateCache(): CandidateDocumentsForRemoval {
  return {
    removalId: "removal-1",
    facilityId: "facility-1",
    hasMapping: true,
    mirroredExternalIds: [],
    candidates: [
      {
        document: { id: "document-1" },
        lineageEntity: { entityLabel: "Application APP-1" },
        binding: { nomaRoleLabel: "Inventory" },
        mirror: null,
      },
    ],
  } as unknown as CandidateDocumentsForRemoval;
}

describe("certification Source cache reconciliation", () => {
  it("writes a server-confirmed mapping and Source ID immediately", () => {
    const result: MirrorResult = {
      externalDocumentId: "source-1",
      isPublic: false,
      recovered: false,
    };

    const updated = applyConfirmedSourceMapping(
      candidateCache(),
      "document-1",
      result,
    );

    expect(updated?.mirroredExternalIds).toEqual(["source-1"]);
    expect(updated?.candidates[0]?.mirror).toMatchObject({
      externalDocumentId: "source-1",
      isPublic: false,
    });
  });

  it("keeps failure reconciliation pending until the refetch settles", async () => {
    let settle!: () => void;
    const refetch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const client = { refetchQueries: refetch } as unknown as QueryClient;

    let completed = false;
    const reconciliation = reconcileCandidateSourcesAfterFailure(
      client,
      "removal-1",
    ).then(() => {
      completed = true;
    });

    await Promise.resolve();
    expect(completed).toBe(false);
    expect(refetch).toHaveBeenCalledOnce();

    settle();
    await reconciliation;
    expect(completed).toBe(true);
  });

  it("settles reconciliation after a failed authoritative refetch", async () => {
    const client = {
      refetchQueries: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as QueryClient;

    await expect(
      reconcileCandidateSourcesAfterFailure(client, "removal-1"),
    ).resolves.toBeUndefined();
  });
});
