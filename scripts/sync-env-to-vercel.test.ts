import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchItemFieldNames, readWorkflowOpReferences, templateOpFieldNames } from "./env-tpl-utils";
import { warnUntrackedOnePasswordVars } from "./sync-env-to-vercel";

vi.mock("./env-tpl-utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("./env-tpl-utils")>();
  return {
    ...original,
    fetchItemFieldNames: vi.fn(),
    // Real workflows by default; a test can pin its own map.
    readWorkflowOpReferences: vi.fn(original.readWorkflowOpReferences),
  };
});

const WORKFLOW_ONLY_FIELDS = [
  "ADMIN_EMAIL",
  "ISOMETRIC_ACCESS_TOKEN",
  "ISOMETRIC_CLIENT_SECRET",
];

afterEach(() => vi.restoreAllMocks());

describe("Vercel sync drift warnings", () => {
  it.each(["staging", "prod", "production"])("reports %s workflow-only fields as information", (env) => {
    vi.mocked(fetchItemFieldNames).mockReturnValue(new Set([
      "DATABASE_URL", ...WORKFLOW_ONLY_FIELDS,
    ]));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const templateFields = templateOpFieldNames();
    for (const name of WORKFLOW_ONLY_FIELDS) {
      expect(templateFields.has(name)).toBe(false);
    }
    warnUntrackedOnePasswordVars(env, templateFields);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("Read only by GitHub workflows"));
    for (const name of WORKFLOW_ONLY_FIELDS) {
      expect(log).toHaveBeenCalledWith(`        ${name}`);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("still warns about fields absent from both the template and that item's workflows", () => {
    vi.mocked(fetchItemFieldNames).mockReturnValue(new Set([
      ...WORKFLOW_ONLY_FIELDS, "UNTRACKED_FIELD", "STAGING_WORKFLOW_FIELD",
    ]));
    vi.mocked(readWorkflowOpReferences).mockReturnValueOnce(new Map([
      ["production", new Map(WORKFLOW_ONLY_FIELDS.map((name) => [name, new Set(["migrate.yml"])]))],
      ["staging", new Map([["STAGING_WORKFLOW_FIELD", new Set(["e2e-live.yml"])]])],
    ]));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // A field only staging workflows read still warns for the production item.
    warnUntrackedOnePasswordVars("prod", new Set());

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2 variable(s)"));
    expect(warn).toHaveBeenCalledWith("        UNTRACKED_FIELD");
    expect(warn).toHaveBeenCalledWith("        STAGING_WORKFLOW_FIELD");
    for (const name of WORKFLOW_ONLY_FIELDS) {
      expect(warn).not.toHaveBeenCalledWith(`        ${name}`);
    }
  });
});
