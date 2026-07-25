import type { CertifierProjectRow } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";
import type { Logger } from "@/lib/log";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shared", () => ({
  appendSyncEventBestEffort: vi.fn(),
  ISOMETRIC_PROVIDER: "isometric",
  REMOVAL_ENTITY_TYPE: "removal",
}));

import {
  checkProtocolVersionAtSubmit,
  PINNED_BIOCHAR_PROTOCOL_VERSION,
} from "./protocol-version-preflight";
import { appendSyncEventBestEffort } from "./shared";

const ORG_CTX = {
  userId: "user-test-1",
  organizationId: "org-test-1",
  orgRole: "owner",
  isPlatformAdmin: false,
} as OrgContext;
const REMOVAL_ID = "00000000-0000-4000-8000-000000000001";

function makeMapping(
  protocolVersion: string | null,
): CertifierProjectRow {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    facilityId: "00000000-0000-4000-8000-000000000003",
    externalProjectId: "prj_test_1",
    protocolVersion,
  } as CertifierProjectRow;
}

function makeLog(): Logger {
  return {
    warn: vi.fn(),
  } as unknown as Logger;
}

describe("checkProtocolVersionAtSubmit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does nothing when the configured version matches the interpretation pin", async () => {
    const log = makeLog();

    await expect(
      checkProtocolVersionAtSubmit({
        orgCtx: ORG_CTX,
        removalId: REMOVAL_ID,
        mapping: makeMapping(PINNED_BIOCHAR_PROTOCOL_VERSION),
        log,
      }),
    ).resolves.toBe("match");

    expect(log.warn).not.toHaveBeenCalled();
    expect(appendSyncEventBestEffort).not.toHaveBeenCalled();
  });

  it("warns and records an audit event when the configured version differs", async () => {
    const log = makeLog();

    await expect(
      checkProtocolVersionAtSubmit({
        orgCtx: ORG_CTX,
        removalId: REMOVAL_ID,
        mapping: makeMapping("1.2"),
        log,
      }),
    ).resolves.toBe("mismatch");

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "mismatch",
        configuredProtocolVersion: "1.2",
        pinnedProtocolVersion: PINNED_BIOCHAR_PROTOCOL_VERSION,
      }),
      expect.stringMatching(/differs/),
    );
    expect(appendSyncEventBestEffort).toHaveBeenCalledWith(
      ORG_CTX,
      expect.objectContaining({
        entityId: REMOVAL_ID,
        operation: "removal:protocol-version-check",
        status: "succeeded",
        responsePayload: expect.objectContaining({
          outcome: "mismatch",
        }),
      }),
      expect.objectContaining({ removalId: REMOVAL_ID }),
    );
  });

  it("warns and records that the configured version is missing", async () => {
    const log = makeLog();

    await expect(
      checkProtocolVersionAtSubmit({
        orgCtx: ORG_CTX,
        removalId: REMOVAL_ID,
        mapping: makeMapping(null),
        log,
      }),
    ).resolves.toBe("missing");

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "missing",
        configuredProtocolVersion: null,
        pinnedProtocolVersion: PINNED_BIOCHAR_PROTOCOL_VERSION,
      }),
      expect.stringMatching(/missing/),
    );
    expect(appendSyncEventBestEffort).toHaveBeenCalledWith(
      ORG_CTX,
      expect.objectContaining({
        responsePayload: expect.objectContaining({
          outcome: "missing",
          configuredProtocolVersion: null,
        }),
      }),
      expect.any(Object),
    );
  });
});
