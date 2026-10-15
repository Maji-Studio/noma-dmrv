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
import { join, relative } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkServerActionExports,
  findServerActionViolations,
  type ServerActionViolation,
} from "../scripts/check-server-action-exports";

// Building and scanning all fixtures can exceed the default hook timeout under load.
const SHARED_SETUP_TIMEOUT_MS = 60_000;

const FIXTURE_OPTIONS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  // Fixtures use standard library globals, not ambient types from repo dependencies.
  types: [],
};

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
export const coreObj = { issueUrl, get getter() { return issueUrl; } };
export class Core { constructor(public ctx: OrgContext) {} run(ctx: OrgContext, id: string) { return ctx.userId + id; } }
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
    const tupleCalled = await issueUrl.call(...([undefined, ctx, input.reportId] as const));
    const tupleBound = await issueUrl.bind(...([undefined, ctx] as const))(input.reportId);
    const tupleApplied = await issueUrl.apply(...([undefined, [ctx, input.reportId]] as const));
    const { apply: applyCore } = Reflect;
    const reflected = await applyCore(issueUrl, undefined, [ctx, input.reportId]);
    const elementApplied = await Reflect["apply"](issueUrl, undefined, [ctx, input.reportId]);
    return [
      direct, called, applied, bound, spread, tupleCalled, tupleBound,
      tupleApplied, reflected, elementApplied,
    ];
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

// Known positions of a rest tuple, template-literal index keys and a spread
// of session contexts stay precise.
export async function preciseSlots(input: any) {
  return withAction(async (ctx) => {
    const restCore = (...args: [OrgContext, ...unknown[]]) => args.length;
    restCore(ctx, input);
    const prefixed = (scopes: { [key: \`scope_\${string}\`]: OrgContext }) => scopes;
    prefixed({ scope_primary: ctx, metadata: input });
    const many = (...scopes: OrgContext[]) => scopes.length;
    return many(...new Set([ctx]));
  });
}

// The fail-closed rule is limited to functions with guarded parameters.
export async function ordinaryInvocations(input: any) {
  const plain = (value: unknown) => value;
  const erased: any = plain;
  erased(input);
  Function.prototype.call.call(plain, undefined, input);
  const tag = (strings: TemplateStringsArray, value: unknown) => value;
  tag\`report\${input}\`;
  const Reflect = { apply: (value: unknown) => value };
  const { apply } = Reflect;
  return apply(input);
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

export async function pushIntoContexts(raw: string) {
  const scopes: OrgContext[] = [];
  scopes.push(...JSON.parse(raw));
  return scopes.length;
}

export async function reflectArguments(input: any, reportId: string) {
  void input; void reportId;
  return Reflect.apply(issueUrl, undefined, arguments);
}

export async function iterableIntoRest(input: Set<any>) {
  return manyScopes(...input);
}

export async function spreadThisIntoCall(input: any) {
  return issueUrl.call(...([undefined, input, "report"] as const));
}

function manyScopes(...scopes: OrgContext[]) {
  return scopes.length;
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

// Tuple-rest counting is defense in depth; contextual checking also rejects these.
const EXOTIC_BYPASSES = [
  ["unknown list into a tuple rest", `
    const core = (...args: [string, OrgContext]) => args.length;
    return Reflect.apply(core, undefined, input);
  `, { line: "return Reflect", node: "input" }],
  ["open spread into a tuple rest", `
    const core = (...args: [string, OrgContext]) => args.length;
    return core(...input);
  `, { line: "return core", node: "...input" }],
  ["apply behind a leading spread", `
    const packed: [undefined, [any, string]] = [undefined, [input, "r"]];
    return issueUrl.apply(...packed);
  `, { line: "return issueUrl", node: "...packed" }],
  ["callee asserted as any", `return (issueUrl as any)(input, "r");`, { line: "return (issueUrl", node: "issueUrl" }],
  ["any-typed callee alias", `
    const invoke: any = issueUrl;
    return invoke(input, "r");
  `, { line: "const invoke", node: "issueUrl" }],
  ["type-erased reflective invocation", `
    const invoke: any = Reflect.apply;
    return invoke(issueUrl, undefined, [input, "r"]);
  `, { line: "return invoke", node: "[input, \"r\"]", only: true }],
  ["type-erased nested forwarder", `
    const invoke: any = Function.prototype.call;
    return invoke.call(issueUrl, undefined, input, "r");
  `, { line: "return invoke", node: "issueUrl" }],
  ["Function.prototype nested forwarder", `
    return Function.prototype.call.call(issueUrl, undefined, input, "r");
  `, { line: "return Function", node: "input" }],
  ["receiver nested forwarder", `
    return issueUrl.call.call(issueUrl, undefined, input, "r");
  `, { line: "return issueUrl", node: "input" }],
  ["Reflect element access", `return Reflect["apply"](issueUrl, undefined, [input, "r"]);`, { line: "return Reflect", node: "[input, \"r\"]" }],
  ["destructured Reflect apply", `
    const { apply } = Reflect;
    return apply(issueUrl, undefined, [input, "r"]);
  `, { line: "return apply", node: "[input, \"r\"]" }],
  ["Reflect construct", `
    function Core(scope: OrgContext) { return { id: scope.userId }; }
    return Reflect.construct(Core, [input]);
  `, { line: "return Reflect", node: "[input]" }],
  ["tagged template substitution", `
    const core = (strings: TemplateStringsArray, scope: OrgContext) => scope.userId;
    return core\`report\${input}\`;
  `, { line: "return core", node: "input" }],
] as const;

const REVIEW_BYPASSES = [
  ["union any signature", "const run = (f: typeof issueUrl | ((a: any, b: string) => Promise<string>), args: any[]) => Reflect.apply(f, undefined, args); return run(issueUrl, [input, \"r\"]);", "issueUrl"],
  ["union Function", "const run = (f: typeof issueUrl | Function, args: any[]) => Reflect.apply(f, undefined, args); return run(issueUrl, [input, \"r\"]);", "issueUrl"],
  ["cast to unrelated signature union", "const erased = issueUrl as (() => Promise<string>) | undefined; return Reflect.apply(erased!, undefined, [input, \"r\"]);", "issueUrl"],
  ["hoisted bind alias", "const helper = (f: any, x: any) => f(x, \"r\"); function warm() { return r(\"x\"); } const r = Function.prototype.bind.call(issueUrl, undefined); return helper(r, input);", "issueUrl"],
  ["unguarded invocation target", "const f: Function & { issueUrl: typeof issueUrl } = input; return Reflect.apply(f, undefined, [input, \"r\"]);", "f"],
  ["Record<number, any>", "const original = [issueUrl]; const callbacks: Record<number, any> = original; return callbacks[0](input, \"r\");", "original"],
  ["ArrayLike<any>", "const original = [issueUrl]; const callbacks: ArrayLike<any> = original; return callbacks[0](input, \"r\");", "original"],

  ["ternary any widening", "const f = input ? input : issueUrl; return f(input, \"r\");", "issueUrl"],
  ["nullish any widening", "return (input ?? issueUrl)(input, \"r\");", "issueUrl"],
  ["array any widening", "const fns = [input, issueUrl]; return fns[1](input, \"r\");", "issueUrl"],
  ["object spread any widening", "const o = { ...input, issueUrl }; return o.issueUrl(input, \"r\");", "issueUrl"],
  ["bind via call later invocation", "return Function.prototype.bind.call(issueUrl, undefined)(input, \"r\");", "input"],
  ["bind via Reflect later invocation", "return Reflect.apply(Function.prototype.bind, issueUrl, [undefined])(input, \"r\");", "input"],
  ["reassigned Reflect alias", "let invoke = Reflect.apply; invoke = (f: Function, _t: unknown, a: ArrayLike<any>) => f(a[1], a[0]); return invoke(issueUrl, undefined, [\"r\", input]);", "issueUrl"],
  ["rest tag", "const core = (s: TemplateStringsArray, ...scopes: OrgContext[]) => scopes.length; return withAction(async ctx => core`${ctx}${input}`);", "input"],
  ["tuple rest tag", "const core = (s: TemplateStringsArray, ...args: [string, OrgContext]) => args.length; return core`${\"r\"}${input}`;", "input"],
  ["tuple rest alias erases context", "const core = (id: string, ctx: OrgContext) => id + ctx.userId; const alias: (...args: [string, any]) => string = core; return alias(\"r\", input);", "core"],

  ["Reflect invokes apply forwarder", "return Reflect.apply(Function.prototype.apply, issueUrl, [undefined, [input, \"r\"]]);", "[input, \"r\"]"],
  ["Reflect invokes bind forwarder", "return Reflect.apply(Function.prototype.bind, issueUrl, [undefined, input])(\"r\");", "[undefined, input]"],

  ["B1 Reflect alias obj", "const R = Reflect; return R.apply(issueUrl, undefined, [input, \"r\"]);", "[input, \"r\"]"],
  ["B2 optional call", "return issueUrl?.call(undefined, input, \"r\");", "input"],
  ["B3 apply tuple union", "const list: [any, string] | [OrgContext, string] = [input, \"r\"]; return issueUrl.apply(undefined, list);", "list"],
  ["B4 getter erased receiver", "return (coreObj as any).getter(input, \"r\");", "coreObj"],
  ["B5 erased receiver property", "return (coreObj as any).issueUrl(input, \"r\");", "coreObj"],
  ["B6 erased receiver alias", "const m: any = coreObj; return m.issueUrl(input, \"r\");", "coreObj"],
  ["B7 any[] holder", "const fns: any[] = [issueUrl]; return fns[0](input, \"r\");", "issueUrl"],
  ["B8 Function-typed param", "const run = (f: Function, args: any[]) => f.apply(undefined, args); return run(issueUrl, [input, \"r\"]);", "issueUrl"],
  ["B9 any-typed param helper", "const run = (f: any, ...a: any[]) => f(...a); return run(issueUrl, input, \"r\");", "issueUrl"],
  ["B10 Reflect.apply of Function.prototype.call", "return Reflect.apply(Function.prototype.call, issueUrl, [undefined, input, \"r\"]);", "[undefined, input, \"r\"]"],
  ["B11 Reflect.apply of issueUrl.call", "return Reflect.apply(issueUrl.call, issueUrl, [undefined, input, \"r\"]);", "[undefined, input, \"r\"]"],
  ["B12 Reflect.apply(Reflect.apply)", "return Reflect.apply(Reflect.apply, undefined, [issueUrl, undefined, [input, \"r\"]]);", "issueUrl"],
  ["B13 call.bind(fn)", "return Function.prototype.call.bind(issueUrl)(undefined, input, \"r\");", "issueUrl"],
  ["B14 call.bind alias", "const callIt = Function.prototype.call.bind(issueUrl); return callIt(undefined, input, \"r\");", "issueUrl"],
  ["B15 const-key computed member", "const k = \"call\"; return issueUrl[k](undefined, input, \"r\");", "input"],
  ["B16 const-key apply", "const k = \"apply\" as const; return issueUrl[k](undefined, [input, \"r\"]);", "[input, \"r\"]"],
  ["B17 non-null callee", "return issueUrl!(input, \"r\");", "input"],
  ["B18 satisfies callee", "return (issueUrl satisfies Function)(input, \"r\");", "input"],
  ["B19 forEach callback", "const one = (ctx: OrgContext) => ctx.userId; return ([input] as any[]).map(one);", "one"],
  ["B20 promise then", "const one = (ctx: OrgContext) => ctx.userId; return Promise.resolve(input).then(one);", "one"],
  ["B21 erased new", "return new (Core as any)(input);", "Core"],
  ["B22 erased method on instance", "return withAction(async (ctx) => (new Core(ctx) as any).run(input, \"r\"));", "new Core(ctx)"],
  ["B23 dynamic import erased", "const mod: any = await import(\"./report-core\"); return mod.issueUrl(input, \"r\");", "await import(\"./report-core\")"],
  ["B24 apply.call", "return Function.prototype.apply.call(issueUrl, undefined, [input, \"r\"]);", "[input, \"r\"]"],
  ["B25 template key", "return issueUrl[`call`](undefined, input, \"r\");", "input"],
  ["B26 call via Function-typed alias", "const f: Function = issueUrl; return f.call(undefined, input, \"r\");", "issueUrl"],
  ["B27 call via Function cast", "return (issueUrl as Function).call(undefined, input, \"r\");", "issueUrl"],
  ["B28 erased through unknown cast", "return (issueUrl as unknown as (a: any, b: string) => Promise<string>)(input, \"r\");", "issueUrl"],
  ["B29 bind with const key", "const k = \"bind\"; return issueUrl[k](undefined, input)(\"r\");", "input"],
  ["B30 ternary const key", "const k = input ? \"call\" : \"call\"; return issueUrl[k](undefined, input, \"r\");", "input"],
  ["astra getter", "const holder = { get invoke(): any { return issueUrl; } }; return holder.invoke(input, \"r\");", "issueUrl"],
  ["astra const Reflect key", "const method = \"apply\" as const; return Reflect[method](issueUrl, undefined, [input, \"r\"]);", "[input, \"r\"]"],
  ["assignment erasure", "let fn: unknown; fn = issueUrl; return fn;", "issueUrl"],
  ["object literal erasure", "const holder: { invoke: any } = { invoke: issueUrl }; return holder.invoke(input, \"r\");", "issueUrl"],
  ["return erasure", "function get(): Function { return issueUrl; } return get().call(undefined, input, \"r\");", "issueUrl"],
  ["deep method erasure", "const tree = { a: { b: { issueUrl } } }; const erased: object = tree; return erased;", "tree"],
  ["sibling signature loss", "const pair = { first: issueUrl, second: issueUrl }; const erased: { first: typeof issueUrl; second: Function } = pair; return erased;", "pair"],
] as const;

const SAFE_REVIEW_CASES = [
  ["union incompatible member preserves signature", "const run = (f: typeof issueUrl | ((a: number, b: string) => Promise<string>)) => 1; return run(issueUrl);"],
  ["construct returns any", "const Make: new (ctx: OrgContext) => any = input; return withAction(async ctx => new Make(ctx));"],
  ["immediate nested bind with session context", "return withAction(async ctx => Function.prototype.bind.call(issueUrl, undefined)(ctx, \"r\"));"],

  ["Record<number, typeof issueUrl>", "const original = [issueUrl]; const callbacks: Record<number, typeof issueUrl> = original; return withAction(async ctx => callbacks[0](ctx, \"r\"));"],
  ["ArrayLike<typeof issueUrl>", "const original = [issueUrl]; const callbacks: ArrayLike<typeof issueUrl> = original; return withAction(async ctx => callbacks[0](ctx, \"r\"));"],
  ["direct returns any", "const parse = (ctx: OrgContext, raw: string): any => ctx.userId + raw; return withAction(async ctx => parse(ctx, \"r\"));"],
  ["method returns any", "const obj = { method(ctx: OrgContext): any { return ctx.userId; } }; return withAction(async ctx => obj.method(ctx));"],
  ["tag returns any", "const tag = (s: TemplateStringsArray, ctx: OrgContext): any => ctx.userId; return withAction(async ctx => tag`id ${ctx}`);"],
  ["direct returns unknown", "const parse = (ctx: OrgContext, raw: string): unknown => ctx.userId + raw; return withAction(async ctx => parse(ctx, \"r\"));"],
  ["method returns unknown", "const obj = { method(ctx: OrgContext): unknown { return ctx.userId; } }; return withAction(async ctx => obj.method(ctx));"],
  ["tag returns unknown", "const tag = (s: TemplateStringsArray, ctx: OrgContext): unknown => ctx.userId; return withAction(async ctx => tag`id ${ctx}`);"],

  ["tuple rest alias retains context", "const core = (id: string, ctx: OrgContext) => id + ctx.userId; const alias: (...args: [string, OrgContext]) => string = core; return withAction(async ctx => alias(\"r\", ctx));"],
  ["tuple rest source retains context", "const core = (...args: [string, OrgContext]) => args[0] + args[1].userId; const alias: (id: string, ctx: OrgContext) => string = core; return withAction(async ctx => alias(\"r\", ctx));"],

  ["session Reflect invokes apply forwarder", "return withAction(async (ctx) => Reflect.apply(Function.prototype.apply, issueUrl, [undefined, [ctx, \"r\"]]));"],
  ["session Reflect invokes bind forwarder", "return withAction(async (ctx) => Reflect.apply(Function.prototype.bind, issueUrl, [undefined, ctx])(\"r\"));"],

  ["satisfies preserves signature", "return withAction(async (ctx) => (issueUrl satisfies Function)(ctx, \"r\"));"],
  ["inferred destructuring retains guarded map methods", "return withAction(async (ctx) => { const [rows, count] = await Promise.all([Promise.resolve(new Map<string, OrgContext>([[\"r\", ctx]])), Promise.resolve(1)]); return rows.size + count; });"],
  ["typed callable property retained", "const holder: { invoke: typeof issueUrl } = { invoke: issueUrl }; return withAction(async (ctx) => holder.invoke(ctx, \"r\"));"],

  ["F1 session ctx via nested forwarder", "return withAction(async (ctx) => issueUrl.call.call(issueUrl, undefined, ctx, input.reportId));"],
  ["F2 tagged template, session ctx", "const fmt = (s: TemplateStringsArray, c: OrgContext) => c.userId + s.join(''); return withAction(async (ctx) => fmt`id ${ctx}`);"],
  ["F6 Reflect.construct with session ctx", "return withAction(async (ctx) => Reflect.construct(Core, [ctx]));"],
  ["F7 destructured Reflect with session ctx", "const { apply } = Reflect; return withAction(async (ctx) => apply(issueUrl, undefined, [ctx, String(input.id)]));"],
  ["F8 bind with variable list of session ctx", "return withAction(async (ctx) => issueUrl.bind(undefined, ...[ctx])(input.reportId));"],
  ["F9 tagged template with no guarded fn (drizzle-like)", "const sqlTag = (s: TemplateStringsArray, ...v: unknown[]) => s.join('') + v.length; return sqlTag`select ${input}`;"],
  ["F10 any-typed callee unrelated receiver", "const o: any = {}; return withAction(async (ctx) => o.track(ctx.userId, input));"],
  ["F12 apply with spread of fixed tuple containing ctx", "return withAction(async (ctx) => Reflect.apply(...([issueUrl, undefined, [ctx, String(input.id)]] as const)));"],
  ["F13 erased callee given withAction", "const anyFn: any = globalThis; return anyFn.run(withAction);"],
  ["F14 Promise.all map with session ctx", "return withAction(async (ctx) => Promise.all((input.ids as string[]).map((id) => issueUrl(ctx, id))));"],
] as const;

const DELIBERATE_REJECTIONS = [
  ["F3 untyped lib called with session ctx-callback (deliberate fail-closed)", "const lib: any = globalThis; return withAction(async (ctx) => lib.register(async (c: OrgContext) => issueUrl(c, \"r\")));", "async (c: OrgContext) => issueUrl(c, \"r\")"],
  ["F4 untyped logger gets core fn ref (deliberate fail-closed)", "const log: any = console.log; log(issueUrl);", "issueUrl"],
  ["F5 untyped call receives Core class (deliberate fail-closed)", "const reg: any = globalThis; reg.registerClass(Core);", "Core"],
  ["F11 erased call on method of object with guarded sibling (deliberate fail-closed)", "return (coreObj as any).other?.(input);", "coreObj"],
] as const;

function writeFixture(dir: string, actions: string): string[] {
  for (const [name, source] of Object.entries(SHARED_FILES)) {
    writeFileSync(join(dir, name), source);
  }
  const actionsFile = join(dir, "actions.ts");
  writeFileSync(actionsFile, actions);
  return [actionsFile, join(dir, "report-core.ts")];
}

function reviewSource(body: string): string {
  return `"use server";
import { withAction, type OrgContext } from "./auth";
import { issueUrl, coreObj, Core } from "./report-core";
export async function action(input: any) { ${body} }
`;
}

function exoticSource(body: string): string {
  return `"use server";
import type { OrgContext } from "./auth";
import { issueUrl } from "./report-core";
export async function action(input: any) { ${body} }
`;
}

describe("check-server-action-exports", () => {
  let fixtureDir: string;
  const fixtures = new Map<string, { dir: string; files: string[] }>();
  const findings = new Map<string, ServerActionViolation[]>();

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "server-action-exports-"));
    const sources = [
      FAILING_ACTIONS, PASSING_ACTIONS, BYPASS_ACTIONS, INLINE_ACTIONS,
      ...[...REVIEW_BYPASSES, ...DELIBERATE_REJECTIONS, ...SAFE_REVIEW_CASES]
        .map(([, body]) => reviewSource(body)),
      ...EXOTIC_BYPASSES.map(([, body]) => exoticSource(body)),
    ];
    // Separate directories keep relative imports and module symbols isolated.
    for (const source of sources) {
      const dir = mkdtempSync(join(fixtureDir, "case-"));
      fixtures.set(source, { dir, files: writeFixture(dir, source) });
    }
    const rootFiles = [...fixtures.values()].flatMap(({ files }) => files);
    const program = ts.createProgram({
      rootNames: rootFiles,
      options: FIXTURE_OPTIONS,
    });
    // One scan also shares the inspector's library-type cache across fixtures.
    const violations = findServerActionViolations(program, rootFiles, fixtureDir);
    for (const [source, fixture] of fixtures) {
      findings.set(source, violations
        .filter(({ file }) => fixture.files.includes(join(fixtureDir, file)))
        .map((violation) => ({
          ...violation,
          file: relative(fixture.dir, join(fixtureDir, violation.file)),
        })));
    }
  }, SHARED_SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
    fixtures.clear();
    findings.clear();
  });

  function checkFixture(source: string) {
    const violations = findings.get(source);
    if (!violations) throw new Error("Fixture was not included in the shared program");
    return violations;
  }

  it("matches the shared finding through the CLI wrapper", () => {
    const [, body, target] = EXOTIC_BYPASSES[0];
    const source = exoticSource(body);
    const fixture = fixtures.get(source);
    if (!fixture) throw new Error("Fixture was not included in the shared program");
    const violations = checkServerActionExports(fixture.dir, fixture.files, FIXTURE_OPTIONS);
    expect(violations).toEqual(checkFixture(source));
    expect(violations).toEqual([
      expect.objectContaining({ name: target.node, reason: expect.stringMatching(/call argument/) }),
    ]);
  });

  it.each([...REVIEW_BYPASSES, ...DELIBERATE_REJECTIONS])("rejects review case %s at its conversion or invocation", (_name, body, target) => {
    const findings = checkFixture(reviewSource(body));
    expect(findings.filter((finding) => finding.line === 4 && finding.name === target && /call argument|callable provenance/.test(finding.reason)))
      .toEqual([expect.objectContaining({ reason: expect.stringMatching(/call argument|callable provenance/) })]);
  });

  it.each(SAFE_REVIEW_CASES)("accepts %s", (_name, body) => {
    expect(checkFixture(reviewSource(body))).toEqual([]);
  });

  it.each(EXOTIC_BYPASSES)(
    "rejects %s",
    (shape, body, target) => {
      if (!target) throw new Error(`Missing exotic assertion target for ${shape}`);
      const source = exoticSource(body);
      const line = source.split("\n").findIndex((text) => text.includes(target.line)) + 1;
      const findings = checkFixture(source);
      expect(findings.filter((finding) => finding.line === line && finding.name === target.node))
        .toEqual([expect.objectContaining({ reason: expect.stringMatching(/call argument|callable provenance/) })]);
      if ("only" in target && target.only) expect(findings).toHaveLength(1);
    },
  );

  it(
    "flags every trusted-context export shape in a \"use server\" module",
    () => {
      const violations = checkFixture(FAILING_ACTIONS);
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
  );

  it(
    "flags deep, indexed, cast, annotated and aliased context bypasses",
    () => {
      const violations = checkFixture(BYPASS_ACTIONS);
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
        "scopes.push(...JSON.parse(raw))",
        "Reflect.apply(issueUrl, undefined, arguments)",
        "manyScopes(...input)",
        'issueUrl.call(...([undefined, input, "report"] as const))',
      ]) {
        expect(reasons(lineOf(needle)), needle).toEqual([
          expect.stringMatching(/call argument/),
        ]);
      }
      // A context parameter of a private helper is checked at its callers.
      expect(reasons(lineOf('issueUrl(args.scope, "report")'))).toEqual([]);
    },
  );

  it(
    "checks guards and parameters inside inline server functions",
    () => {
      const violations = checkFixture(INLINE_ACTIONS);
      expect(violations.map((v) => [v.name, v.reason])).toEqual([
        ["inlineGuard", expect.stringMatching(/raw tenant id|organization context/)],
        ["requireOrgRole", expect.stringMatching(/parameter "form"/)],
        ["OrgContext", expect.stringMatching(/type assertion/)],
      ]);
    },
  );

  it(
    "accepts session-resolving actions and type re-exports",
    () => {
      expect(checkFixture(PASSING_ACTIONS)).toEqual([]);
    },
  );
});
