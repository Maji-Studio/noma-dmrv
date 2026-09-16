import { describe, expect, it } from "vitest";
import { parseInjectedEnv } from "../scripts/sync-env-to-vercel";

describe("parseInjectedEnv", () => {
  it("keeps single-line values and strips their quotes", () => {
    const parsed = parseInjectedEnv('A="one"\n# comment\nB=two\nC=\'three\'\n');
    expect([...parsed]).toEqual([
      ["A", "one"],
      ["B", "two"],
      ["C", "three"],
    ]);
  });

  it("joins a double-quoted value that spans several lines", () => {
    const pem = "-----BEGIN CERTIFICATE-----\nabc\ndef\n-----END CERTIFICATE-----";
    const parsed = parseInjectedEnv(`DATABASE_URL="x"\nDATABASE_CA_CERT="${pem}"\nAFTER=1\n`);
    expect(parsed.get("DATABASE_CA_CERT")).toBe(pem);
    expect(parsed.get("AFTER")).toBe("1");
  });
});
