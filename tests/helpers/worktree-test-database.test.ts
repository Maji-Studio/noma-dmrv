import { describe, expect, it } from "vitest";
import { isWorktreeTestDatabaseUrl } from "./worktree-test-database";

const url = (db: string, host = "localhost", query = "") =>
  `postgresql://postgres:postgres@${host}:5433/${db}${query}`;

describe("isWorktreeTestDatabaseUrl", () => {
  it.each([
    "noma_dmrv_wt_readings_upload_test",
    "noma_dmrv_wt_wt_migrate_test",
    "noma_dmrv_wt_x1_test",
  ])("accepts worktree test database %s", (db) => {
    expect(isWorktreeTestDatabaseUrl(url(db))).toBe(true);
    expect(isWorktreeTestDatabaseUrl(url(db, "127.0.0.1"))).toBe(true);
  });

  it.each([
    "noma_dmrv_test",
    "noma_dmrv_dev",
    "noma_dmrv_wt_x_dev",
    "noma_dmrv_wt_x_test_old",
    "noma_dmrv_wt__test",
    "noma_dmrv_wt_X_test",
    "prefix_noma_dmrv_wt_x_test",
    "noma_dmrv_wt_x_test\n",
    "app_template_test",
  ])("rejects database %s", (db) => {
    expect(isWorktreeTestDatabaseUrl(url(db))).toBe(false);
  });

  it("rejects non-local hosts", () => {
    expect(isWorktreeTestDatabaseUrl(url("noma_dmrv_wt_x_test", "db.example.com"))).toBe(false);
    expect(isWorktreeTestDatabaseUrl(url("noma_dmrv_wt_x_test", "10.0.0.5"))).toBe(false);
  });

  it("rejects query parameters that override the target", () => {
    expect(isWorktreeTestDatabaseUrl(url("noma_dmrv_wt_x_test", "localhost", "?host=db.example.com"))).toBe(false);
    expect(isWorktreeTestDatabaseUrl(url("noma_dmrv_wt_x_test", "localhost", "?dbname=noma_dmrv_dev"))).toBe(false);
  });

  it("rejects unparseable URLs", () => {
    expect(isWorktreeTestDatabaseUrl("not a url")).toBe(false);
  });
});
