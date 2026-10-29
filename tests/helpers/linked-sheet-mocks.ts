/**
 * Shared `vi.mock` factories for list tests whose sheet follows a URL param
 * (`?reactor=<id>`): a URL store the nuqs setters write to, and the single
 * record read behind a link.
 *
 *   vi.mock("nuqs", async () => (await import("../../../tests/helpers/linked-sheet-mocks")).nuqsModule);
 *   vi.mock("@/hooks/use-entity-edit-record", async () =>
 *     (await import("../../../tests/helpers/linked-sheet-mocks")).entityEditRecordModule);
 */
export interface LinkedRecordRead {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
}

export const linkedSheet = {
  params: {} as Record<string, string | null>,
  record: { data: undefined, isLoading: false, isError: false, isSuccess: false } as LinkedRecordRead,
  reset() {
    this.params = {};
    this.record = { data: undefined, isLoading: false, isError: false, isSuccess: false };
  },
  /** The linked record finished loading. */
  found(data: unknown) {
    this.record = { data, isLoading: false, isError: false, isSuccess: true };
  },
  /** The linked record read settled without a record. */
  missing() {
    this.record = { data: undefined, isLoading: false, isError: false, isSuccess: true };
  },
};

export const nuqsModule = {
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [
    linkedSheet.params[key] ?? null,
    (value: string | null) => {
      linkedSheet.params[key] = value;
      return Promise.resolve(new URLSearchParams());
    },
  ],
};

export const entityEditRecordModule = {
  useEntityEditRecord: () => linkedSheet.record,
};
