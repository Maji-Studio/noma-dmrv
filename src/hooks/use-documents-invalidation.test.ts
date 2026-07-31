import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { certificationKeys } from "./use-certification";
import { productionRunKeys } from "./use-production-runs";
import {
  invalidateDeletedDocumentOwner,
  invalidateDocumentOwner,
} from "./use-documents";

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

  it.each(["upload", "delete"])(
    "refreshes production-run list, detail, and certification readiness after %s",
    async (mutation) => {
      const invalidateQueries = vi.fn().mockResolvedValue(undefined);
      const queryClient = { invalidateQueries } as unknown as QueryClient;
      const owner = { entityType: "production_run", entityId: "run-1" } as const;

      if (mutation === "upload") {
        await invalidateDocumentOwner(queryClient, owner);
      } else {
        await invalidateDeletedDocumentOwner(queryClient, owner);
      }

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: productionRunKeys.lists(),
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: productionRunKeys.detail("run-1"),
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: certificationKeys.all,
      });
    },
  );
});
