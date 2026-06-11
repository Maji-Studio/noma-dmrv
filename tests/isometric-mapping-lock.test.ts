import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => {
  const transaction = vi.fn();
  return {
    db: {
      transaction,
      insert: vi.fn(),
      update: vi.fn(),
      select: vi.fn(),
    },
  };
});

import { db } from "@/db";
import {
  insertDraftSubmissionWithMappingLock,
  resetSubmissionToDraftWithMappingLock,
  type MappingClaimGuard,
  type InsertDraftSubmissionInput,
} from "@/data-access/certification-submissions";
import { SafeError } from "@/lib/errors";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";

const USER_ID = "user-1";
const FACILITY_ID = "fac-1";
const CURRENT_PROJECT = "prj_current";
const NEW_PROJECT = "prj_new";

const baseInput: InsertDraftSubmissionInput = {
  provider: "isometric",
  submissionType: "removal",
  localEntityType: "creditBatch",
  localEntityId: "cb-1",
  version: 1,
  payloadSnapshot: { semantic: {}, transport: {} },
  payloadHash: "h1",
};

const baseGuard: MappingClaimGuard = {
  facilityId: FACILITY_ID,
  provider: "isometric",
  expectedExternalProjectId: CURRENT_PROJECT,
  expectedDefaultRemovalTemplateId: "rvt_default",
};

interface LockedRow {
  externalProjectId: string;
  defaultRemovalTemplateId: string | null;
}

type TxCallback = (tx: unknown) => Promise<unknown>;
function mockTransaction(stubTx: unknown): void {
  (db.transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: TxCallback) => fn(stubTx),
  );
}

function buildTxStub(opts: {
  lockedRow: LockedRow | null;
  insertReturn?: unknown;
  updateReturn?: unknown;
}) {
  const insertCalls: unknown[] = [];
  const updateCalls: unknown[] = [];

  const limitMock = vi.fn(() => Promise.resolve(opts.lockedRow ? [opts.lockedRow] : []));
  const forUpdateMock = vi.fn(() => ({ limit: limitMock }));
  const whereSelectMock = vi.fn(() => ({ for: forUpdateMock }));
  const fromMock = vi.fn(() => ({ where: whereSelectMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  const insertReturningMock = vi.fn(() =>
    Promise.resolve(opts.insertReturn ? [opts.insertReturn] : []),
  );
  const insertValuesMock = vi.fn((values: unknown) => {
    insertCalls.push(values);
    return { returning: insertReturningMock };
  });
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn(() =>
    Promise.resolve(opts.updateReturn ? [opts.updateReturn] : []),
  );
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn((values: unknown) => {
    updateCalls.push(values);
    return { where: updateWhereMock };
  });
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    tx: { select: selectMock, insert: insertMock, update: updateMock },
    insertCalls,
    updateCalls,
  };
}

describe("insertDraftSubmissionWithMappingLock", () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockReset();
  });

  it("throws when the locked mapping no longer exists", async () => {
    const stub = buildTxStub({ lockedRow: null });
    mockTransaction(stub.tx);

    await expect(
      insertDraftSubmissionWithMappingLock(USER_ID, baseInput, baseGuard),
    ).rejects.toBeInstanceOf(SafeError);
    expect(stub.insertCalls).toHaveLength(0);
  });

  it("throws when externalProjectId changed under the lock and skips the insert", async () => {
    const stub = buildTxStub({
      lockedRow: {
        externalProjectId: NEW_PROJECT,
        defaultRemovalTemplateId: "rvt_default",
      },
    });
    mockTransaction(stub.tx);

    await expect(
      insertDraftSubmissionWithMappingLock(USER_ID, baseInput, baseGuard),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/repointed/i),
    });
    expect(stub.insertCalls).toHaveLength(0);
  });

  it("throws when defaultRemovalTemplateId changed under the lock", async () => {
    const stub = buildTxStub({
      lockedRow: {
        externalProjectId: CURRENT_PROJECT,
        defaultRemovalTemplateId: "rvt_other",
      },
    });
    mockTransaction(stub.tx);

    await expect(
      insertDraftSubmissionWithMappingLock(USER_ID, baseInput, baseGuard),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/template changed/i),
    });
    expect(stub.insertCalls).toHaveLength(0);
  });

  it("inserts the draft when the locked mapping still matches", async () => {
    const insertedRow = { id: "sub_1", version: 1 };
    const stub = buildTxStub({
      lockedRow: {
        externalProjectId: CURRENT_PROJECT,
        defaultRemovalTemplateId: "rvt_default",
      },
      insertReturn: insertedRow,
    });
    mockTransaction(stub.tx);

    const row = await insertDraftSubmissionWithMappingLock(USER_ID, baseInput, baseGuard);
    expect(row).toEqual(insertedRow);
    expect(stub.insertCalls).toHaveLength(1);
  });

  it("ignores defaultRemovalTemplateId when the guard omits it", async () => {
    const insertedRow = { id: "sub_1", version: 1 };
    const stub = buildTxStub({
      lockedRow: {
        externalProjectId: CURRENT_PROJECT,
        defaultRemovalTemplateId: "rvt_other",
      },
      insertReturn: insertedRow,
    });
    mockTransaction(stub.tx);

    const guardWithoutTemplate: MappingClaimGuard = {
      facilityId: FACILITY_ID,
      provider: "isometric",
      expectedExternalProjectId: CURRENT_PROJECT,
    };
    const row = await insertDraftSubmissionWithMappingLock(
      USER_ID,
      baseInput,
      guardWithoutTemplate,
    );
    expect(row).toEqual(insertedRow);
    expect(stub.insertCalls).toHaveLength(1);
  });
});

describe("resetSubmissionToDraftWithMappingLock", () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockReset();
  });

  it("aborts the reset when the locked mapping changed", async () => {
    const stub = buildTxStub({
      lockedRow: {
        externalProjectId: NEW_PROJECT,
        defaultRemovalTemplateId: "rvt_default",
      },
    });
    mockTransaction(stub.tx);

    await expect(
      resetSubmissionToDraftWithMappingLock(
        USER_ID,
        "sub_1",
        baseGuard,
        LOCK_TTL_MS,
      ),
    ).rejects.toBeInstanceOf(SafeError);
    expect(stub.updateCalls).toHaveLength(0);
  });

  it("resets the row to draft when the locked mapping still matches", async () => {
    const updatedRow = { id: "sub_1", status: "draft" };
    const stub = buildTxStub({
      lockedRow: {
        externalProjectId: CURRENT_PROJECT,
        defaultRemovalTemplateId: "rvt_default",
      },
      updateReturn: updatedRow,
    });
    mockTransaction(stub.tx);

    const row = await resetSubmissionToDraftWithMappingLock(
      USER_ID,
      "sub_1",
      baseGuard,
      LOCK_TTL_MS,
    );
    expect(row).toEqual(updatedRow);
    expect(stub.updateCalls).toHaveLength(1);
  });

  it("throws when a concurrent caller already claimed the row", async () => {
    // The compare-and-swap UPDATE matches no row — another submit already
    // reset it to a fresh draft — so the resume aborts instead of
    // double-POSTing to the registry.
    const stub = buildTxStub({
      lockedRow: {
        externalProjectId: CURRENT_PROJECT,
        defaultRemovalTemplateId: "rvt_default",
      },
      // no updateReturn → returning() yields [] → zero rows updated
    });
    mockTransaction(stub.tx);

    await expect(
      resetSubmissionToDraftWithMappingLock(
        USER_ID,
        "sub_1",
        baseGuard,
        LOCK_TTL_MS,
      ),
    ).rejects.toBeInstanceOf(SafeError);
    expect(stub.updateCalls).toHaveLength(1);
  });
});
