import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkActionBoundaries,
  findActionBoundarySites,
  walkSourceFiles,
  type ActionBoundaryException,
} from "../scripts/check-action-boundaries";

const ACTION_FILE = "src/fn/items.ts";
const HOOK_FILE = "src/hooks/use-items.ts";
const HAND_ROLLED_ACTION = `"use server";
export async function createItem(input: unknown) {
  try {
    const ctx = await requireOrgContext();
    return { success: true, data: await create(ctx, input) };
  } catch (error) {
    if (error instanceof SafeError) {
      return { success: false, error: error.message };
    }
    return ({ "success": false, error: "Failed to create item." } as const);
  }
}`;
const EXCEPTION: ActionBoundaryException = {
  file: ACTION_FILE,
  function: "createItem",
  sites: { "org-context": 1, "catch-failure": 2 },
  reason: "Fixture action intentionally runs without an active organization.",
};

describe("findActionBoundarySites", () => {
  it("flags a hand-rolled action, including conditional and cast failure returns", () => {
    const sites = findActionBoundarySites(HAND_ROLLED_ACTION, ACTION_FILE);
    expect(sites.map(({ file, line, function: name }) => [file, line, name])).toEqual([
      [ACTION_FILE, 4, "createItem"],
      [ACTION_FILE, 8, "createItem"],
      [ACTION_FILE, 10, "createItem"],
    ]);
    expect(sites.every(({ message }) => message.includes("docs/architecture.md"))).toBe(true);
  });

  it("passes an action using withAction and mapError", () => {
    const source = `export async function createItem(input: unknown) {
      return withAction(async (ctx) => create(ctx, input), {
        mapError: (error) => ({ success: false, error: error.message }),
      });
    }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([]);
  });

  it("passes an inner catch that translates and rethrows", () => {
    const source = `export async function createItem() {
      return withAction(async (ctx) => {
        try { return await create(ctx); }
        catch (error) { throw new SafeError(error.message); }
      });
    }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([]);
  });

  it("does not mistake a nested callback's return for a catch return", () => {
    const source = `async function createItem() {
      try { await create(); } catch (error) {
        const fallback = () => ({ success: false, error: "nested" });
        async function other() { return { success: false, error: "nested" }; }
        throw error;
      }
    }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([]);
  });

  it("flags a hand-written unwrap using any result identifier, attributed to its hook", () => {
    const source = `export function useCreateItem() {
      return useMutation({ mutationFn: async () => {
        const response = await createItem();
        if (!response.success) throw new Error(response.error);
        return response.data;
      }});
    }`;
    expect(findActionBoundarySites(source, HOOK_FILE)).toEqual([
      expect.objectContaining({ file: HOOK_FILE, line: 4, function: "useCreateItem" }),
    ]);
  });

  it("names variable functions and methods", () => {
    const source = `const createItem = async () => { await requireOrgContext(); };
      const actions = { async removeItem() { await requireOrgContext(); } };`;
    expect(findActionBoundarySites(source, ACTION_FILE).map((site) => site.function)).toEqual([
      "createItem", "removeItem",
    ]);
  });

  it("ignores comments, strings, unrelated throws, and non-failure catch returns", () => {
    const source = `// throw new Error(result.error)
      const example = "throw new Error(result.error)";
      function useItem() { throw new Error("Failed to load."); }
      function other() { throw new CustomError(result.error); }`;
    expect(findActionBoundarySites(source, HOOK_FILE)).toEqual([]);
    expect(findActionBoundarySites(`async function createItem() {
      try {} catch (error) { return { success: true, data: null }; }
    }`, ACTION_FILE)).toEqual([]);
  });

  it("recognizes literal computed success keys without guessing dynamic keys", () => {
    const source = `async function createItem() {
      try {} catch (error) {
        if (error) return { ["success"]: false, error: "literal" };
        return { [success]: false, error: "dynamic" };
      }
    }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
      expect.objectContaining({ line: 3, function: "createItem" }),
    ]);
  });

  it("permits requireOrgContext only in the canonical boundary", () => {
    const source = `async function withAction() { await requireOrgContext(); }`;
    expect(findActionBoundarySites(source, "src/fn/with-action.ts")).toEqual([]);
    expect(findActionBoundarySites(source, ACTION_FILE)).toHaveLength(1);
  });

  it.each(["requireOrgContext", "getOrgContext"])("tracks named import aliases for %s at every call", (name) => {
    const source = `import { ${name} as getCtx } from "@/lib/auth/server";
      async function createItem() { await getCtx(); await getCtx(); }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
      expect.objectContaining({ line: 2, function: "createItem", kind: "org-context" }),
      expect.objectContaining({ line: 2, function: "createItem", kind: "org-context" }),
    ]);
    expect(findActionBoundarySites(source, "src/fn/with-action.ts")).toEqual([]);
  });

  it("reports unused named imports at the import, but ignores unrelated and type-only imports", () => {
    const source = `import { requireOrgContext as getCtx, getOrgContext } from "@/lib/auth/server";
      import { unrelated as other } from "@/lib/auth/server";
      import type { requireOrgContext as typeOnly } from "@/lib/auth/server";
      import { type getOrgContext as anotherType } from "@/lib/auth/server";
      import { requireOrgContext as elsewhere } from "./other";
      other(); elsewhere();`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
      expect.objectContaining({ line: 1, function: "<module>", kind: "org-context" }),
      expect.objectContaining({ line: 1, function: "<module>", kind: "org-context" }),
    ]);
  });

  it("tracks org-context calls through the auth namespace only", () => {
    const source = `import * as auth from "@/lib/auth/server";
      import * as other from "./other";
      async function createItem() {
        await auth.requireOrgContext(); await auth.getOrgContext();
        await auth.requirePlatformAdmin(); await other.getOrgContext();
      }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toHaveLength(2);
    expect(findActionBoundarySites(source, "src/fn/with-action.ts")).toEqual([]);
  });

  it("tracks an org-context alias from the auth barrel", () => {
    const source = `import { requireOrgContext as getCtx } from "@/lib/auth";
      async function createItem() { await getCtx(); }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
      expect.objectContaining({ line: 2, function: "createItem", kind: "org-context" }),
    ]);
  });

  it("tracks org-context calls from the auth barrel namespace", () => {
    const source = `import * as auth from "@/lib/auth";
      async function createItem() { await auth.requireOrgContext(); await auth.getOrgContext(); }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
      expect.objectContaining({ line: 2, function: "createItem", kind: "org-context" }),
      expect.objectContaining({ line: 2, function: "createItem", kind: "org-context" }),
    ]);
  });

  it.each(["../lib/auth/server", "../lib/auth", "../../lib/auth/server", "../../lib/auth"])(
    "tracks org-context aliases and namespaces from relative import %s",
    (module) => {
      const source = `import { getOrgContext as getCtx } from "${module}";
        import * as auth from "${module}";
        async function createItem() { await getCtx(); await auth.requireOrgContext(); }`;
      expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
        expect.objectContaining({ line: 3, function: "createItem", kind: "org-context" }),
        expect.objectContaining({ line: 3, function: "createItem", kind: "org-context" }),
      ]);
    },
  );

  it.each(["./action-errors", "@/fn/action-errors", "../action-errors", "../../fn/action-errors"])(
    "tracks toActionFailure aliases from %s",
    (module) => {
      const source = `import { toActionFailure as fail } from "${module}";
        function createItem() { return fail(error); }`;
      expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
        expect.objectContaining({ line: 2, function: "createItem", kind: "action-failure" }),
      ]);
      expect(findActionBoundarySites(source, "src/fn/with-action.ts")).toEqual([]);
      expect(findActionBoundarySites(source, "src/fn/action-errors.ts")).toEqual([]);
    },
  );

  it.each(["./action-errors", "@/fn/action-errors", "../action-errors", "../../fn/action-errors"])(
    "tracks toActionFailure namespace calls from %s",
    (module) => {
      const source = `import * as errors from "${module}";
        function createItem() { return errors.toActionFailure(error); }`;
      expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
        expect.objectContaining({ line: 2, function: "createItem", kind: "action-failure" }),
      ]);
      expect(findActionBoundarySites(source, "src/fn/with-action.ts")).toEqual([]);
      expect(findActionBoundarySites(source, "src/fn/action-errors.ts")).toEqual([]);
    },
  );

  it("ignores unrelated modules and type-only failure bindings", () => {
    const source = `import { requireOrgContext as getCtx } from "other/lib/auth";
      import * as auth from "../lib/auth-client";
      import { toActionFailure as fail } from "other/action-errors";
      import * as errors from "./action-errors-other";
      import type { toActionFailure as typeFail } from "./action-errors";
      import { type toActionFailure as inlineTypeFail } from "@/fn/action-errors";
      import type * as typeErrors from "../action-errors";
      function createItem() {
        getCtx(); auth.getOrgContext(); fail(error); errors.toActionFailure(error);
        typeFail(error); inlineTypeFail(error); typeErrors.toActionFailure(error);
      }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([]);
  });

  it.each([
    'error ? { success: false } : { success: true }',
    'error ? { success: true } : { success: false }',
    'error ? { success: false } : { success: false }',
  ])("flags conditional catch failures once per return: %s", (expression) => {
    const source = `async function createItem() { try {} catch (error) { return ${expression}; } }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
      expect.objectContaining({ kind: "catch-failure", function: "createItem" }),
    ]);
  });

  it("flags a returned local failure initialized in the same block", () => {
    const source = `async function createItem() {
      try {} catch (error) {
        const failure = ({ success: false, error: "Failed." } as const);
        return failure;
      }
    }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
      expect.objectContaining({ line: 4, kind: "catch-failure" }),
    ]);
  });

  it("does not resolve locals from other blocks or after the return", () => {
    const source = `async function createItem() {
      const outer = { success: false };
      try {} catch (error) {
        if (error) { const nested = { success: false }; }
        if (error) return outer;
        if (error) return nested;
        return later;
        const later = { success: false };
      }
    }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([]);
  });

  it("flags toActionFailure calls both inside and outside a catch", () => {
    const source = `function createItem() {
      toActionFailure(error);
      try {} catch (error) { return toActionFailure(error); }
    }`;
    expect(findActionBoundarySites(source, ACTION_FILE)).toEqual([
      expect.objectContaining({ line: 2, kind: "action-failure" }),
      expect.objectContaining({ line: 3, kind: "action-failure" }),
    ]);
    expect(findActionBoundarySites(source, "src/fn/with-action.ts")).toEqual([]);
    expect(findActionBoundarySites(source, "src/fn/action-errors.ts")).toEqual([]);
  });

  it.each([
    'new Error(r.error)',
    'Error(r.error)',
    'new Error(r.error ?? "Failed.")',
    'Error(`Failed: ${r.error}`)',
    'new Error(o.r.error)',
    'Error(r["error"])',
    'new Error((r["error"] ?? "Failed.") as string)',
    'new Error(o.r?.error)',
  ])("flags hook Error variants: %s", (expression) => {
    expect(findActionBoundarySites(`function useItem() { throw ${expression}; }`, HOOK_FILE)).toEqual([
      expect.objectContaining({ kind: "hook-unwrap", function: "useItem" }),
    ]);
  });

  it("ignores Error arguments that do not contain an error access", () => {
    const source = `function useItem() {
      if (x) throw Error("r.error");
      if (x) throw new Error(r[error]);
      throw new CustomError(r.error);
    }`;
    expect(findActionBoundarySites(source, HOOK_FILE)).toEqual([]);
  });

  it("skips test files and files outside the scan, and parses TSX hooks", () => {
    expect(findActionBoundarySites(HAND_ROLLED_ACTION, "src/fn/items.test.ts")).toEqual([]);
    expect(findActionBoundarySites(HAND_ROLLED_ACTION, "src/lib/items.ts")).toEqual([]);
    expect(findActionBoundarySites(HAND_ROLLED_ACTION, "src/fn/items.tsx")).toHaveLength(3);
    const hook = `function useItem() { const view = <span />; throw new Error(result.error); }`;
    expect(findActionBoundarySites(hook, "src/hooks/use-item.tsx")).toHaveLength(1);
    expect(findActionBoundarySites(hook, "src/hooks/use-item.spec.tsx")).toEqual([]);
  });
});

describe("checkActionBoundaries", () => {
  it("passes an allowlisted site", () => {
    expect(checkActionBoundaries([
      { file: ACTION_FILE, source: HAND_ROLLED_ACTION },
    ], [EXCEPTION])).toEqual([]);
  });

  it("does not allowlist another function in the same file", () => {
    const source = `${HAND_ROLLED_ACTION}\nasync function other() { await requireOrgContext(); }`;
    expect(checkActionBoundaries([{ file: ACTION_FILE, source }], [EXCEPTION])).toEqual([
      expect.objectContaining({ function: "other" }),
    ]);
  });

  it("fails a stale entry even when its function still exists", () => {
    expect(checkActionBoundaries([
      { file: ACTION_FILE, source: "async function createItem() { return withAction(create); }" },
    ], [EXCEPTION])).toEqual([
      expect.objectContaining({
        file: ACTION_FILE,
        function: "createItem",
        kind: "org-context",
        message: expect.stringContaining("Stale allowlist entry"),
      }),
      expect.objectContaining({
        file: ACTION_FILE,
        function: "createItem",
        kind: "catch-failure",
        message: expect.stringContaining("Stale allowlist entry"),
      }),
    ]);
  });

  it("fails a stale entry when its file disappeared", () => {
    expect(checkActionBoundaries([], [EXCEPTION])).toHaveLength(2);
  });

  it("fails an extra catch inside an allowlisted function", () => {
    const source = HAND_ROLLED_ACTION.replace('    const ctx', '    try {} catch (error) { return { success: false }; }\n    const ctx');
    expect(checkActionBoundaries([{ file: ACTION_FILE, source }], [EXCEPTION])).toEqual([
      expect.objectContaining({ kind: "catch-failure", message: expect.stringContaining("Allowlist growth") }),
    ]);
  });

  it("fails a reduced site count even when that kind is still present", () => {
    const source = HAND_ROLLED_ACTION.replace('return { success: false, error: error.message };', 'throw error;');
    expect(checkActionBoundaries([{ file: ACTION_FILE, source }], [EXCEPTION])).toEqual([
      expect.objectContaining({
        kind: "catch-failure",
        message: expect.stringContaining("expected 2 site(s), found 1"),
      }),
    ]);
  });

  it("fails substituting one allowed site kind for another", () => {
    const source = `async function createItem() { try {} catch (error) { return { success: false }; } }`;
    const allowlist = [{ ...EXCEPTION, sites: { "org-context": 1 } }];
    expect(checkActionBoundaries([{ file: ACTION_FILE, source }], allowlist)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "catch-failure", message: expect.stringContaining("Allowlist growth") }),
      expect.objectContaining({ kind: "org-context", message: expect.stringContaining("Stale allowlist entry") }),
    ]));
    expect(checkActionBoundaries([{ file: ACTION_FILE, source }], allowlist)).toHaveLength(2);
  });
});

describe("walkSourceFiles", () => {
  it("scans nested TS and TSX files and skips test files and __tests__", () => {
    const root = mkdtempSync(join(tmpdir(), "action-boundary-walk-"));
    try {
      for (const directory of ["nested", "__tests__/nested", "nested/__tests__"]) {
        mkdirSync(join(root, directory), { recursive: true });
      }
      for (const file of ["items.ts", "nested/items.tsx", "items.test.ts", "nested/items.test.tsx", "nested/items.spec.ts", "__tests__/nested/items.ts", "nested/__tests__/items.tsx", "notes.md"]) {
        writeFileSync(join(root, file), HAND_ROLLED_ACTION);
      }
      const files = walkSourceFiles(root);
      expect(files.map((file) => relative(root, file)).sort()).toEqual(["items.ts", "nested/items.tsx"]);
      expect(files.flatMap((file) => findActionBoundarySites(HAND_ROLLED_ACTION, `src/fn/${relative(root, file)}`))).toHaveLength(6);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
