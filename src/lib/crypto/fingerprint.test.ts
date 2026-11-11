import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { encodeCursor } from "@/lib/api/cursor";
import { clientIpBucketKey } from "@/lib/api/client-ip";
import { fingerprint } from "./fingerprint";

const HEX_DIGEST = /^[a-f0-9]{64}$/;
const legacy = (input: string) => createHash("sha256").update(input).digest("hex");

/** Evaluate the real pure functions/expressions without importing DB-backed modules. */
function evaluate(fileName: string, names: string[], expression: string, scope: Record<string, unknown> = {}) {
  const source = readFileSync(fileName, "utf8");
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const selected = file.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""))
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => names.includes(decl.name.getText(file)))));
  expect(selected).toHaveLength(names.length);
  const code = selected.map(node => node.getText(file).replace(/^export /, "")).join("\n");
  const js = ts.transpile(`${code}\n${expression}`, { target: ts.ScriptTarget.ESNext });
  return runInNewContext(js, { fingerprint, ...scope });
}

describe("lookup fingerprints preserve legacy SHA-256 bytes", () => {
  it.each(["", "lookup-key", "é:雪", "a\u0000b"])("returns the same hex digest for %j", value => {
    expect(fingerprint(value)).toMatch(HEX_DIGEST);
    expect(fingerprint(value)).toBe(legacy(value));
  });

  it("keeps cursor binding serialization, omitted filters and sorted keys", () => {
    const binding = { organizationId: "org-a", resource: "bins", filters: { z: true, omitted: undefined, a: "wet" } };
    const encoded = encodeCursor({ createdAt: "2026-01-01T00:00:00Z", id: "00000000-0000-4000-8000-000000000001" }, binding);
    const expected = legacy(JSON.stringify({ organizationId: binding.organizationId, resource: binding.resource,
      filters: Object.entries(binding.filters).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)),
    }));
    expect(JSON.parse(Buffer.from(encoded, "base64url").toString()).binding).toBe(expected);
  });

  it("keeps the bin movement payload shape and bigint replacer", () => {
    const payload = { bin: "bin-a", mass: BigInt(123), nested: { delta: BigInt(-4) }, values: [null, "wet"] };
    const expected = legacy(JSON.stringify(payload, (_, value) => typeof value === "bigint" ? value.toString() : value));
    expect(evaluate("src/data-access/bin-movement-requests.ts", ["requestFingerprint"], "requestFingerprint(payload)", { payload })).toBe(expected);
  });

  it.each([{ target: "bin-a", precondition: '"v2"' }, {}])("keeps the runner contract envelope and sorted nested JSON: %j", idempotency => {
    const input = { z: 1, a: { z: 2, a: 3 }, rows: [{ y: false, b: null }] };
    const envelope = { apiVersion: "v1", operationId: "update_bin", input,
      target: "target" in idempotency ? idempotency.target : null,
      precondition: "precondition" in idempotency ? idempotency.precondition : null };
    const expected = legacy(JSON.stringify(envelope, (_key, value: unknown) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
      }
      return value;
    }));
    expect(evaluate("src/lib/operations/runner.ts", ["stableJson", "requestFingerprint", "API_CONTRACT_VERSION"],
      'requestFingerprint("update_bin", input, idempotency)', { input, idempotency })).toBe(expected);
  });

  it("keeps the IP prefix, trusted header selection and untrusted fallback", () => {
    const headers = new Headers({ "x-forwarded-for": " 192.0.2.1, 192.0.2.2" });
    expect(clientIpBucketKey(headers, true)).toBe(`ip:${legacy("192.0.2.1")}`);
    expect(clientIpBucketKey(headers, false)).toBe(`ip:${legacy("unknown")}`);
  });

  it("keeps customer cascade version, sorted order IDs and comma separator", () => {
    const fileName = "src/data-access/customer-writes.ts";
    const source = readFileSync(fileName, "utf8");
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    let expression = "";
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && node.name.getText(file) === "cascadeFingerprint") expression = node.initializer.getText(file);
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(expression).not.toBe("");
    const lockedOrders = [{ id: "order-z" }, { id: "order-a" }];
    expect(evaluate(fileName, ["CASCADE_FINGERPRINT_VERSION"], expression, { lockedOrders }))
      .toBe(`v1:${legacy(lockedOrders.map(row => row.id).sort().join(","))}`);
  });
});
