/**
 * Shared `vi.mock` factories for list tests that are not about record locks:
 * every record answers Open, so Edit and Delete are offered as before.
 *
 *   vi.mock("@/hooks/use-record-locks", async () =>
 *     (await import("../../../tests/helpers/record-lock-mocks")).openRecordLocksModule);
 */
import type { RecordLockView } from "@/lib/record-lock-view";

export const OPEN_LOCK: RecordLockView = {
  level: "open", heldBy: [], usedBy: [], freeFields: [], howToFree: null, returnedBy: [],
};

export const openRecordLocksModule = {
  useRecordLocks: () => ({
    locks: new Proxy({}, { get: () => OPEN_LOCK }),
    statusOf: () => "ready" as const,
  }),
  useRecordLock: () => ({ lock: OPEN_LOCK, status: "ready" as const }),
};

/** Stubs the lock UI for tests that render a list without its chip and lines. */
export const stubRecordLockComponentsModule = {
  RecordLockChip: () => null,
  RecordLockNotice: () => null,
  RecordUsedBy: () => null,
  RecordLockFormFrame: ({ children }: { children: unknown }) => children,
  recordLockColumn: () => ({ id: "recordLock", header: "Lock", cell: () => null }),
  recordLockTitleMark: () => () => null,
  recordLockSheetProps: () => ({}),
};
