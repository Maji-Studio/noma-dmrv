/**
 * The list caches feed the edit sheets that save with `expectedUpdatedAt`
 * (issue #768), so the row they hold has to carry a version the server wrote.
 */

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { patchListCachesWithSavedRow } from "./list-cache-utils";

interface Row {
  id: string;
  name: string;
  facilityName: string;
  updatedAt: Date;
}

const OPENED_ON = new Date("2026-09-01T00:00:00.000Z");
const SAVED_AT = new Date("2026-09-02T00:00:00.000Z");

const page = (row: Row) => ({ items: [row], total: 1, page: 1, pageSize: 10 });

const row: Row = {
  id: "row-1",
  name: "Bin A",
  facilityName: "Mafinga",
  updatedAt: OPENED_ON,
};

describe("patchListCachesWithSavedRow", () => {
  it("installs the saved row in every cached page and keeps the envelope", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["bins", "list", { page: 1 }], page(row));
    queryClient.setQueryData(["bins", "list", { page: 2 }], page(row));

    patchListCachesWithSavedRow<Row>(queryClient, ["bins", "list"], {
      id: "row-1",
      name: "Bin A2",
      updatedAt: SAVED_AT,
    });

    for (const key of [{ page: 1 }, { page: 2 }]) {
      const cached = queryClient.getQueryData<ReturnType<typeof page>>([
        "bins",
        "list",
        key,
      ]);
      expect(cached?.total).toBe(1);
      expect(cached?.items[0]).toEqual({
        id: "row-1",
        name: "Bin A2",
        // The joined column the saved row does not carry survives the patch.
        facilityName: "Mafinga",
        updatedAt: SAVED_AT,
      });
    }
  });

  it("leaves other rows and uncached lists alone", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["bins", "list", { page: 1 }], page(row));

    patchListCachesWithSavedRow<Row>(queryClient, ["bins", "list"], {
      id: "other-row",
      updatedAt: SAVED_AT,
    });

    const cached = queryClient.getQueryData<ReturnType<typeof page>>([
      "bins",
      "list",
      { page: 1 },
    ]);
    expect(cached?.items[0]?.updatedAt).toBe(OPENED_ON);
  });
});
