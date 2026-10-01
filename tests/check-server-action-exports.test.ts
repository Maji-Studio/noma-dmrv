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
import {
  requireOrgRole,
  requireOrgRole as assertRole,
  withAction,
  type OrgContext,
} from "./auth";
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

export async function generic<T extends OrgContext>(ctx: T) {
  return ctx.userId;
}

export async function aliasedGuard(args: { c: unknown }) {
  assertRole(args.c as OrgContext, "admin");
}

export async function localFromParameter(input: unknown) {
  const scope = input as OrgContext;
  requireOrgRole(scope, "admin");
}

export async function rawTenantId(organizationId: string) {
  return organizationId;
}

export async function rawTenantIdProperty(input: { orgId: string; name: string }) {
  return input.name;
}

export async function withoutOrganizationId(ctx: Omit<OrgContext, "organizationId">) {
  return ctx.isPlatformAdmin;
}

export async function deeplyNested(input: { a: { b: { ctx: OrgContext } } }) {
  return input.a;
}

export async function mappedContexts(contexts: unknown[]) {
  return contexts.map((ctx) => requireOrgRole(ctx as OrgContext, "admin"));
}

export { issueUrl } from "./report-core";
`;

const PASSING_ACTIONS = `"use server";
import { requireOrgRole, withAction, type OrgContext } from "./auth";
import { issueUrl } from "./report-core";

export async function issueUrlAction(input: { reportId: string }) {
  return withAction(async (ctx) => {
    requireOrgRole(ctx, "admin");
    return issueUrl(ctx, input.reportId);
  });
}

type Recursive = Recursive[];

// A self-referential input type must not send the inspector into a loop.
export async function recursiveInput(input: Recursive) {
  return input.length;
}

// An \`any\` that lands in a non-context slot is ordinary input, however the
// core is invoked.
export async function anyIntoReportId(input: any) {
  return withAction(async (ctx) => {
    const direct = await issueUrl(ctx, input.reportId);
    const called = await issueUrl.call(undefined, ctx, input.reportId);
    const applied = await issueUrl.apply(undefined, [ctx, input.reportId]);
    const bound = await issueUrl.bind(undefined, ctx)(input.reportId);
    const spread = await issueUrl(...([ctx, input.reportId] as const));
    return [direct, called, applied, bound, spread];
  });
}

// A numeric index signature takes no named property, and a callable
// object's own \`call\` method is not Function.prototype.call.
export async function namedPropertyBesideNumericIndex(input: any) {
  return withAction(async (ctx) => {
    const byPosition = (scopes: Record<number, OrgContext>) => scopes[0];
    const value = { metadata: input, 0: ctx };
    byPosition(value);
    const callable = Object.assign((scope: OrgContext) => scope.userId, {
      call: (payload: unknown) => payload,
    });
    return callable.call(input);
  });
}

export async function renameReport(input: unknown) {
  return withAction(async (ctx) => {
    const scope = ctx;
    requireOrgRole(scope, "admin");
    // Re-typing the session context is not a forged context.
    const typed: OrgContext = ctx as OrgContext;
    const results: OrgContext[] = [];
    results.push(typed);
    return input;
  });
}

export type { OrgContext } from "./auth";
`;

// Shapes that reintroduce a context without a context-typed parameter.
const BYPASS_ACTIONS = `"use server";
import { requireOrgRole, type OrgContext } from "./auth";
import { issueUrl } from "./report-core";

export async function veryDeep(input: { a: { b: { c: { d: { ctx: OrgContext } } } } }) {
  return input.a;
}

export async function indexed(contexts: Record<string, OrgContext>) {
  return Object.keys(contexts);
}

export async function castIntoCore(input: unknown) {
  return issueUrl(input as OrgContext, "report");
}

export async function castSpread(input: unknown) {
  const scope = { ...(input as OrgContext) };
  return scope.userId;
}

export async function assignedLater(input: unknown) {
  let scope: OrgContext;
  scope = input as OrgContext;
  return scope.userId;
}

export async function annotatedAny(input: any) {
  const scope: OrgContext = input;
  return scope.userId;
}

export async function localGuardAlias(input: any) {
  const check = requireOrgRole;
  check(input, "admin");
}

export async function parsedIntoCore(raw: string, reportId: string) {
  return issueUrl(JSON.parse(raw), reportId);
}

export async function anyIntoCore(input: any) {
  return issueUrl(input, "report");
}

export async function anyPropertyIntoCore(input: any) {
  const wrapped = { scope: input };
  return scopedUrl(wrapped);
}

export async function anyLiteralIntoCore(input: any) {
  return scopedUrl({ scope: input });
}

function scopedUrl(args: { scope: OrgContext }) {
  return issueUrl(args.scope, "report");
}

export async function spreadIntoCore(input: any) {
  return issueUrl(...[input, "report"]);
}

export async function spreadTupleIntoCore(input: any) {
  const args: [any, string] = [input, "report"];
  return issueUrl(...args);
}

export async function callIntoCore(input: any) {
  return issueUrl.call(undefined, input, "report");
}

export async function applyIntoCore(input: any) {
  return issueUrl.apply(undefined, [input, "report"]);
}

export async function bindIntoCore(input: any) {
  return issueUrl.bind(undefined, input)("report");
}

export async function boundThenCalled(input: any) {
  return issueUrl.bind(undefined)(input, "report");
}

export async function genericIntoCore(input: any) {
  return forwardScope(input);
}

export async function tupleIntoCore(input: any) {
  return pairedUrl(["report", input]);
}

export async function indexedIntoCore(input: any) {
  return keyedUrl({ primary: input });
}

export async function elementAccessIntoCore(input: any) {
  return issueUrl["call"](undefined, input, "report");
}

export async function reflectIntoCore(input: any) {
  return Reflect.apply(issueUrl, undefined, [input, "report"]);
}

export async function optionalCallIntoCore(input: any, maybeCore?: typeof issueUrl) {
  return maybeCore?.call(undefined, input, "report");
}

export async function variadicIntoCore(input: any) {
  return trailingScope(["report", "report", input]);
}

function trailingScope(args: [...string[], OrgContext]) {
  return args.length;
}

function forwardScope<T extends OrgContext>(ctx: T) {
  return issueUrl(ctx, "report");
}

function pairedUrl([reportId, scope]: [string, OrgContext]) {
  return issueUrl(scope, reportId);
}

function keyedUrl(scopes: Record<string, OrgContext>) {
  return issueUrl(scopes.primary, "report");
}
`;

// Not a "use server" module: only the inline server functions are actions.
const INLINE_ACTIONS = `
import { requireOrgRole, type OrgContext } from "./auth";

export function Page() {
  async function inlineGuard(ctx: OrgContext) {
    "use server";
    return ctx.userId;
  }
  const submit = async (form: unknown) => {
    "use server";
    requireOrgRole(form as OrgContext, "admin");
  };
  return [inlineGuard, submit];
}
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
      expect(byName.get("generic")).toMatch(/organization context/);
      expect(byName.get("rawTenantId")).toMatch(/raw tenant id/);
      expect(byName.get("rawTenantIdProperty")).toMatch(/"orgId" accepts a raw tenant id/);
      expect(byName.get("withoutOrganizationId")).toMatch(/"orgRole"|"isPlatformAdmin"/);
      expect(byName.get("deeplyNested")).toMatch(/property "a" property "b" property "ctx"/);
      const guardFindings = violations
        .filter((v) => v.name === "requireOrgRole")
        .map((v) => v.reason);
      // guarded (cast), trustsParameter (private helper), aliasedGuard
      // (aliased import + property access + cast), localFromParameter (local
      // initialised from a parameter), mappedContexts (a callback parameter
      // fed by caller input, not by withAction).
      expect(guardFindings).toEqual([
        expect.stringMatching(/parameter "ctx"/),
        expect.stringMatching(/parameter "ctx"/),
        expect.stringMatching(/parameter "args"/),
        expect.stringMatching(/parameter "input"/),
        expect.stringMatching(/parameter "ctx"/),
      ]);
      // The directive-free core is never an action, whatever it accepts.
      expect(violations.every((v) => v.file === "actions.ts")).toBe(true);
    },
    CHECK_TIMEOUT_MS,
  );

  it(
    "flags deep, indexed, cast, annotated and aliased context bypasses",
    () => {
      const bypassDir = mkdtempSync(join(tmpdir(), "server-action-bypass-"));
      try {
        const files = writeFixture(bypassDir, BYPASS_ACTIONS);
        const violations = checkServerActionExports(
          bypassDir,
          files,
          FIXTURE_OPTIONS,
        );
        const reasons = (line: number) =>
          violations.filter((v) => v.line === line).map((v) => v.reason);
        const lineOf = (needle: string) =>
          BYPASS_ACTIONS.split("\n").findIndex((l) => l.includes(needle)) + 1;

        const byName = new Map(violations.map((v) => [v.name, v.reason]));
        expect(byName.get("veryDeep")).toMatch(/property "d" property "ctx"/);
        expect(byName.get("indexed")).toMatch(/index signature/);
        expect(reasons(lineOf("issueUrl(input as OrgContext"))).toEqual([
          expect.stringMatching(/type assertion/),
        ]);
        expect(reasons(lineOf("...(input as OrgContext)"))).toEqual([
          expect.stringMatching(/type assertion/),
        ]);
        expect(reasons(lineOf("scope = input as OrgContext"))).toEqual(
          expect.arrayContaining([expect.stringMatching(/type assertion/)]),
        );
        expect(reasons(lineOf("const scope: OrgContext = input"))).toEqual([
          expect.stringMatching(/annotated local/),
        ]);
        expect(reasons(lineOf('check(input, "admin")'))).toEqual([
          expect.stringMatching(/requireOrgRole\(\) is applied to the parameter "input"/),
        ]);
        // An `any` flows into a context slot without any cast.
        for (const needle of [
          "issueUrl(JSON.parse(raw), reportId)",
          'issueUrl(input, "report")',
          "scopedUrl(wrapped)",
          "scopedUrl({ scope: input })",
        ]) {
          expect(reasons(lineOf(needle))).toEqual([
            expect.stringMatching(/call argument/),
          ]);
        }
        // Indirect calls, generic forwarding, later tuple elements and index
        // signatures hide the context slot from the contextual type (#877).
        for (const needle of [
          'issueUrl(...[input, "report"])',
          "issueUrl(...args)",
          'issueUrl.call(undefined, input, "report")',
          'issueUrl.apply(undefined, [input, "report"])',
          "issueUrl.bind(undefined, input)",
          'issueUrl.bind(undefined)(input, "report")',
          "forwardScope(input)",
          'pairedUrl(["report", input])',
          "keyedUrl({ primary: input })",
          'issueUrl["call"](undefined, input, "report")',
          'Reflect.apply(issueUrl, undefined, [input, "report"])',
          'maybeCore?.call(undefined, input, "report")',
          'trailingScope(["report", "report", input])',
        ]) {
          expect(reasons(lineOf(needle)), needle).toEqual([
            expect.stringMatching(/call argument/),
          ]);
        }
        // A context parameter of a private helper is checked at its callers.
        expect(reasons(lineOf('issueUrl(args.scope, "report")'))).toEqual([]);
      } finally {
        rmSync(bypassDir, { recursive: true, force: true });
      }
    },
    CHECK_TIMEOUT_MS,
  );

  it(
    "checks guards and parameters inside inline server functions",
    () => {
      const inlineDir = mkdtempSync(join(tmpdir(), "server-action-inline-"));
      try {
        const files = writeFixture(inlineDir, INLINE_ACTIONS);
        const violations = checkServerActionExports(
          inlineDir,
          files,
          FIXTURE_OPTIONS,
        );
        expect(violations.map((v) => [v.name, v.reason])).toEqual([
          ["inlineGuard", expect.stringMatching(/raw tenant id|organization context/)],
          ["requireOrgRole", expect.stringMatching(/parameter "form"/)],
          ["OrgContext", expect.stringMatching(/type assertion/)],
        ]);
      } finally {
        rmSync(inlineDir, { recursive: true, force: true });
      }
    },
    CHECK_TIMEOUT_MS,
  );

  it(
    "accepts session-resolving actions and type re-exports",
    () => {
      const files = writeFixture(passingDir, PASSING_ACTIONS);
      expect(
        checkServerActionExports(passingDir, files, FIXTURE_OPTIONS),
      ).toEqual([]);
    },
    CHECK_TIMEOUT_MS,
  );
});
