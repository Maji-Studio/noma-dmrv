/**
 * Shared `vi.mock` factory for list tests that render without a QueryClient.
 * `useLinkedRecordFacility` reads a facility outside the selectable list by id
 * to learn whether it is archived; here every such facility answers active,
 * so a linked record shows where it is, as before #1499.
 *
 *   vi.mock("@/hooks/use-facilities", async (importOriginal) =>
 *     (await import("../../../tests/helpers/facility-lookup-mocks")).activeFacilityLookupModule(await importOriginal()));
 */
export function activeFacilityLookupModule<T extends object>(original: T) {
  return {
    ...original,
    useFacility: (facilityId: string) => ({
      data: facilityId ? { id: facilityId, name: "Facility", archivedAt: null } : undefined,
      isError: false,
    }),
  };
}
