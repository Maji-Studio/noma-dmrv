import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { certificationKeys } from "./use-certification";
import { invalidateDeletedDocumentOwner } from "./use-documents";

describe("invalidateDeletedDocumentOwner", () => {
  it("refreshes certification readiness for deleted application evidence", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await invalidateDeletedDocumentOwner(queryClient, {
      entityType: "application",
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: certificationKeys.all,
    });
  });
});
