import { describe, expect, it } from "vitest";
import { filterTemplateToItem, parseWorkflowOpReferences, REQUIRED_DEPLOYED_VARS } from "./env-tpl-utils";

describe("required deployed variables", () => {
  it.each(["staging", "production"])("requires the Isometric environment when syncing %s", (env) => {
    const template = `ISOMETRIC_ENVIRONMENT="op://Environment Variables/noma-dmrv env ${env}/ISOMETRIC_ENVIRONMENT"`;

    expect(REQUIRED_DEPLOYED_VARS.has("ISOMETRIC_ENVIRONMENT")).toBe(true);
    expect(filterTemplateToItem(template, new Set(), REQUIRED_DEPLOYED_VARS)).toEqual({
      filtered: template,
      skipped: [],
      missingRequired: ["ISOMETRIC_ENVIRONMENT"],
    });
    expect(filterTemplateToItem(template, new Set(["ISOMETRIC_ENVIRONMENT"]), REQUIRED_DEPLOYED_VARS)).toEqual({
      filtered: template,
      skipped: [],
      missingRequired: [],
    });
  });
});

describe("parseWorkflowOpReferences", () => {
  it("groups quoted and unquoted references by env and deduplicates fields", () => {
    const workflow = `
env:
  ADMIN_PASSWORD: op://Environment Variables/noma-dmrv env staging/ADMIN_PASSWORD
  RESET: "op://Environment Variables/noma-dmrv env staging/DB_RESET_ALLOW_REMOTE"
  ADMIN_AGAIN: 'op://Environment Variables/noma-dmrv env staging/ADMIN_PASSWORD'
  DATABASE_URL: 'op://Environment Variables/noma-dmrv env production/DATABASE_URL'
  SECRET: "op://Environment Variables/noma-dmrv env production/BETTER_AUTH_SECRET"
  LOCAL_URL: op://Environment Variables/noma-dmrv env local/NEXT_PUBLIC_APP_URL
`;

    expect(parseWorkflowOpReferences(workflow)).toEqual(new Map([
      ["staging", new Set(["ADMIN_PASSWORD", "DB_RESET_ALLOW_REMOTE"])],
      ["production", new Set(["DATABASE_URL", "BETTER_AUTH_SECRET"])],
      ["local", new Set(["NEXT_PUBLIC_APP_URL"])],
    ]));
  });

  it("ignores other vaults, item prefixes, and commented-out references", () => {
    const workflow = `
env:
  OTHER_VAULT: op://Other Vault/noma-dmrv env staging/ADMIN_PASSWORD
  VAULT_SUFFIX: op://Environment Variables archive/noma-dmrv env staging/ADMIN_PASSWORD
  OTHER_ITEM: op://Environment Variables/other-app env staging/ADMIN_PASSWORD
  PREFIX_SUFFIX: op://Environment Variables/noma-dmrv environment staging/ADMIN_PASSWORD
  # COMMENTED: op://Environment Variables/noma-dmrv env staging/ADMIN_PASSWORD
`;

    expect(parseWorkflowOpReferences(workflow)).toEqual(new Map());
  });

  it("returns no references when the workflow has none", () => {
    expect(parseWorkflowOpReferences("jobs:\n  test:\n    runs-on: ubuntu-latest\n")).toEqual(new Map());
  });
});
