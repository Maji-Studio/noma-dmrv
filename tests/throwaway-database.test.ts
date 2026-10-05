import { describe, expect, it } from "vitest";
import {
  assertThrowawayTestDatabase,
  resolveTestDatabaseUrl,
} from "./helpers/throwaway-database";

const local = (dbName: string, host = "localhost") =>
  `postgresql://postgres:postgres@${host}:5433/${dbName}`;

describe("assertThrowawayTestDatabase", () => {
  it("accepts the CI database", () => {
    expect(() =>
      assertThrowawayTestDatabase("postgresql://postgres:postgres@127.0.0.1:5432/noma_dmrv_test"),
    ).not.toThrow();
  });

  it.each(["noma_dmrv_test", "noma_dmrv_e2e", "app_template_test", "noma_dmrv_guardrails_test"])(
    "accepts the local throwaway name %s",
    (dbName) => {
      expect(() => assertThrowawayTestDatabase(local(dbName))).not.toThrow();
    },
  );

  it.each(["noma_dmrv_dev", "noma_dmrv", "postgres", "noma_dmrv_testing", "contest"])(
    "rejects %s",
    (dbName) => {
      expect(() => assertThrowawayTestDatabase(local(dbName))).toThrow(/throwaway/);
    },
  );

  it("rejects a test-named database on a remote host", () => {
    expect(() =>
      assertThrowawayTestDatabase(local("noma_dmrv_test", "db.example.com")),
    ).toThrow(/throwaway/);
  });

  it("rejects an unparseable URL", () => {
    expect(() => assertThrowawayTestDatabase("not a url")).toThrow(/throwaway/);
  });

  it("never echoes credentials", () => {
    expect(() =>
      assertThrowawayTestDatabase("postgresql://postgres:hunter2@localhost:5433/noma_dmrv_dev"),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("hunter2") }));
  });
});

describe("resolveTestDatabaseUrl", () => {
  it("prefers TEST_DATABASE_URL over DATABASE_URL", () => {
    expect(
      resolveTestDatabaseUrl({
        TEST_DATABASE_URL: local("noma_dmrv_test"),
        DATABASE_URL: local("noma_dmrv_dev"),
      }),
    ).toBe(local("noma_dmrv_test"));
  });

  it("falls back to DATABASE_URL", () => {
    expect(resolveTestDatabaseUrl({ DATABASE_URL: local("noma_dmrv_test") })).toBe(
      local("noma_dmrv_test"),
    );
  });

  it("returns undefined when neither is set", () => {
    expect(resolveTestDatabaseUrl({})).toBeUndefined();
  });
});
