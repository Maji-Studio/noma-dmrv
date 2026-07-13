import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("first production bootstrap", () => {
  it("supports an explicit one-time fresh-database migration gate", () => {
    const workflow = readRepoFile(".github/workflows/migration-gate.yml");
    expect(workflow).toContain("first-production-deployment");
    expect(workflow).toContain("fresh_database");
  });

  it("bootstraps the production admin after automatic migrations", () => {
    const workflow = readRepoFile(".github/workflows/migrate.yml");
    expect(workflow).toContain(
      "ADMIN_EMAIL: op://Environment Variables/noma-dmrv env production/ADMIN_EMAIL",
    );
    expect(workflow).toContain(
      "ADMIN_PASSWORD: op://Environment Variables/noma-dmrv env production/ADMIN_PASSWORD",
    );
    expect(workflow).toContain(
      "CREDENTIALS_ENCRYPTION_KEY: op://Environment Variables/noma-dmrv env production/CREDENTIALS_ENCRYPTION_KEY",
    );
    expect(workflow).toContain(
      "ISOMETRIC_ACCESS_TOKEN: op://Environment Variables/noma-dmrv env production/ISOMETRIC_ACCESS_TOKEN",
    );
    expect(workflow).toContain(
      "ISOMETRIC_CLIENT_SECRET: op://Environment Variables/noma-dmrv env production/ISOMETRIC_CLIENT_SECRET",
    );
    expect(workflow).toContain("pnpm db:ensure-admin");
  });

  it("never seeds the shared dev teammate in production", () => {
    const source = readRepoFile("src/lib/cli/ensure-admin.ts");
    expect(source).toContain("NODE_ENV === 'production'");
    expect(source).toContain("Skipping dev teammate in production");
  });
});
