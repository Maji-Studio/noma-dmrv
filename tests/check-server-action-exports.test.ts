/**
 * The Server Action boundary gate.
 *
 * Every export of a `"use server"` module is a public action. The gate is the
 * only thing that stops a trusted-context helper (one that takes an
 * `OrgContext`) from being exported there again, so it is tested against a
 * fixture that reproduces each leak shape it must catch and one that follows
 * the allowed pattern.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkServerActionExports } from "../scripts/check-server-action-exports";

const FIXTURE_OPTIONS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
};
// Loading the default lib for a fresh program is the slow part.
const CHECK_TIMEOUT_MS = 30_000;

const SHARED_FILES: Record<string, string> = {
  "auth.ts": `
export interface OrgContext {
  userId: string;
  organizationId: string;
  orgRole: "owner" | "admin" | "member" | null;
  isPlatformAdmin: boolean;
}
export function requireOrgRole(ctx: OrgContext, role: "admin"): void {
  void ctx; void role;
}
export async function withAction<T>(fn: (ctx: OrgContext) => Promise<T>): Promise<T> {
  return fn({ userId: "u", organizationId: "o", orgRole: "admin", isPlatformAdmin: false });
}
`,
  // A directive-free core may take a trusted context; it is never an action.
  "report-core.ts": `
import type { OrgContext } from "./auth";
export async function issueUrl(ctx: OrgContext, reportId: string): Promise<string> {
  return ctx.organizationId + reportId;
}
`,
};

const FAILING_ACTIONS = `"use server";
import { requireOrgRole, withAction, type OrgContext } from "./auth";
import { issueUrl } from "./report-core";

type Ctx = OrgContext;

export async function aliased(ctx: Ctx, id: string) {
  return issueUrl(ctx, id);
}

export async function passthrough(...args: Parameters<typeof issueUrl>) {
  return issueUrl(...args);
}

export async function structural(scope: { organizationId: string; userId: string }) {
  return scope.userId;
}

export async function nested(input: { scope?: OrgContext | null; id: string }) {
  return input.id;
}

export async function withTx(tx: { select(): void; insert(): void; execute(): void }) {
  tx.select();
}

export const arrow = async (ctx: OrgContext) => ctx.userId;

export async function guarded(ctx: unknown) {
  requireOrgRole(ctx as OrgContext, "admin");
  return withAction(async () => ctx);
}

async function trustsParameter(ctx: any) {
  requireOrgRole(ctx, "admin");
}
void trustsParameter;

export { issueUrl } from "./report-core";
`;

const PASSING_ACTIONS = `"use server";
import { requireOrgRole, withAction } from "./auth";
import { issueUrl } from "./report-core";

export async function issueUrlAction(input: { reportId: string }) {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, "admin");
    return issueUrl(ctx, input.reportId);
  });
}

// server-action-ok: the organization id is a form input the action re-checks against the session.
export async function switchOrganization(input: { organizationId: string }) {
  return withAction(async (ctx) => ctx.organizationId === input.organizationId);
}

export type { OrgContext } from "./auth";
`;

function writeFixture(dir: string, actions: string): string[] {
  for (const [name, source] of Object.entries(SHARED_FILES)) {
    writeFileSync(join(dir, name), source);
  }
  const actionsFile = join(dir, "actions.ts");
  writeFileSync(actionsFile, actions);
  return [actionsFile, join(dir, "report-core.ts")];
}

describe("check-server-action-exports", () => {
  let failingDir: string;
  let passingDir: string;

  beforeAll(() => {
    failingDir = mkdtempSync(join(tmpdir(), "server-action-fail-"));
    passingDir = mkdtempSync(join(tmpdir(), "server-action-pass-"));
  });

  afterAll(() => {
    rmSync(failingDir, { recursive: true, force: true });
    rmSync(passingDir, { recursive: true, force: true });
  });

  it(
    "flags every trusted-context export shape in a \"use server\" module",
    () => {
      const files = writeFixture(failingDir, FAILING_ACTIONS);
      const violations = checkServerActionExports(
        failingDir,
        files,
        FIXTURE_OPTIONS,
      );
      const byName = new Map(violations.map((v) => [v.name, v.reason]));

      expect(byName.get("aliased")).toMatch(/organization context/);
      expect(byName.get("passthrough")).toMatch(/rest parameter typed Parameters</);
      expect(byName.get("structural")).toMatch(/organization context/);
      expect(byName.get("nested")).toMatch(/property "scope"/);
      expect(byName.get("withTx")).toMatch(/database or transaction handle/);
      expect(byName.get("arrow")).toMatch(/organization context/);
      expect(byName.get("issueUrl")).toMatch(/organization context/);
      const guardFindings = violations.filter(
        (v) => v.name === "requireOrgRole",
      );
      expect(guardFindings.map((v) => v.reason)).toEqual([
        expect.stringMatching(/parameter "ctx"/),
        expect.stringMatching(/parameter "ctx"/),
      ]);
      // The directive-free core is never an action, whatever it accepts.
      expect(violations.every((v) => v.file === "actions.ts")).toBe(true);
    },
    CHECK_TIMEOUT_MS,
  );

  it(
    "accepts session-resolving actions, type re-exports and waived exports",
    () => {
      const files = writeFixture(passingDir, PASSING_ACTIONS);
      expect(
        checkServerActionExports(passingDir, files, FIXTURE_OPTIONS),
      ).toEqual([]);
    },
    CHECK_TIMEOUT_MS,
  );
});
