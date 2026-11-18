import { expect, it } from "vitest";
import { SOURCE_IDS, type AutomaticSourceId } from "./catalog-sources";
import type { LineContract } from "./line-sources";
import { recordsNeedFile, allowedFilePolicies, defaultFilePolicy, effectiveFilePolicy, entriesNeedFiles, FILE_POLICIES, LINE_FILE_SOURCES } from "./file-policies";

const entryPolicies = ["none", "single", "additive"] as const;
const sources: (AutomaticSourceId | undefined)[] = [...Object.values(SOURCE_IDS), "safety-margin", undefined];
const defaults = {
  "run-genset-diesel": "lineFile", "run-startup-diesel": "lineFile", "run-electricity": "lineFile",
  "feedstock-transport": "generated", "delivery-transport": "generated", "sample-transport": "generated", sequestration: "generated",
} as const;

it.each(sources.flatMap((automaticSource) => entryPolicies.map((entryPolicy) => ({ automaticSource, entryPolicy }))))(
  "resolves defaults and allowed settings for $automaticSource with $entryPolicy entries", (contract) => {
    const expected = defaults[contract.automaticSource as keyof typeof defaults] ?? (contract.entryPolicy === "none" ? "none" : "entryFiles");
    expect(defaultFilePolicy(contract)).toBe(expected);
    expect(effectiveFilePolicy(contract)).toBe(expected);
    const supportsFile = LINE_FILE_SOURCES.some((source) => source === contract.automaticSource);
    expect(allowedFilePolicies(contract)).toEqual(supportsFile ? FILE_POLICIES : ["entryFiles", "generated", "none"]);
    expect(effectiveFilePolicy({ ...contract, filePolicy: "lineFile" })).toBe(supportsFile ? "lineFile" : expected);
    for (const filePolicy of ["entryFiles", "generated", "none"] as const) {
      expect(effectiveFilePolicy({ ...contract, filePolicy })).toBe(filePolicy);
    }
  },
);

it("falls back for an unknown stored setting without throwing", () => {
  const stale = { entryPolicy: "single", filePolicy: "retired" } as unknown as LineContract;
  expect(effectiveFilePolicy(stale)).toBe("entryFiles");
});

it.each(FILE_POLICIES)("defines the manual entry requirement for %s", (policy) => {
  expect(entriesNeedFiles(policy)).toBe(policy !== "none");
});

it.each([
  ["lineFile", "0", false], ["lineFile", "0.000", false], ["lineFile", "-0", false],
  ["lineFile", "0.5", true], ["lineFile", "unreadable", true], ["lineFile", "", true],
  ["entryFiles", "0.5", false], ["generated", "0.5", false], ["none", "0.5", false],
  ["none", "unreadable", false],
] as const)("recordsNeedFile(%s, %s) is %s", (policy, total, needed) => {
  expect(recordsNeedFile(policy, total)).toBe(needed);
});
