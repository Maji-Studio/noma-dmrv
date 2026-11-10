import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  ...mocks,
}));
vi.mock("./use-create-intent-key", () => ({ useIntentMutation: mocks.useMutation }));

import { useSaveFacilityCertifierMapping, useSaveFacilityEmissionConfig } from "./use-certification";
import { certificationKeys } from "./certification-query-keys";
import { useSetOrgCertifierCredentials } from "./use-certifier-credentials";
import { useApplyRemovalTemplateSetup } from "./use-removal-template-setup";
import {
  useArchiveFeedstockType,
  useCreateFeedstockType,
  useDeleteFeedstockType,
  useImportIsometricFeedstockType,
  useUnarchiveFeedstockType,
  useUpdateFeedstockType,
} from "./use-feedstock-types";
import { dashboardOverviewKeys } from "./use-dashboard-overview";

afterEach(() => vi.clearAllMocks());

describe("readiness-affecting settings saves", () => {
  it.each([
    ["facility mapping", useSaveFacilityCertifierMapping],
    ["emission config", useSaveFacilityEmissionConfig],
    ["template setup", useApplyRemovalTemplateSetup],
    ["credentials", () => useSetOrgCertifierCredentials("org-1")],
    ["feedstock type create", useCreateFeedstockType],
    ["feedstock type update", useUpdateFeedstockType],
    ["feedstock type import", useImportIsometricFeedstockType],
    ["feedstock type archive", useArchiveFeedstockType],
    ["feedstock type restore", useUnarchiveFeedstockType],
    ["feedstock type delete", useDeleteFeedstockType],
  ])("refreshes cached dashboard and Removal readiness after %s", async (_label, useSave) => {
    const client = new QueryClient();
    mocks.useQueryClient.mockReturnValue(client);
    const keys = [
      dashboardOverviewKeys.overview("facility-1", "month"),
      certificationKeys.overview("facility-1"),
      certificationKeys.certifyContextForRemoval("facility-1", "removal-1"),
    ];
    for (const key of keys) client.setQueryData(key, { staleReadiness: true });

    useSave();
    const [{ onSuccess }] = mocks.useMutation.mock.calls[0] as [{
      onSuccess: (data: unknown, variables: { facilityId: string }) => unknown;
    }];
    await onSuccess({ id: "type-1", version: 2, status: {} }, { facilityId: "facility-1" });

    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
    client.clear();
  });
});
