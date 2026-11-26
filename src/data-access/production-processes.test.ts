import { expect, it, vi } from "vitest";
import { processScopeLockKey, sortProcessScopes } from "./production-processes";

vi.mock("@/db", () => ({ db: {} }));

it("pins the process advisory key shared by blocking and try locks", () => {
  expect(processScopeLockKey({ facilityId: "facility-123", feedstockTypeId: "type-456" }))
    .toBe("production-process-current:facility-123:type-456");
});

it("orders scopes by that same advisory key", () => {
  const scopes = [{ facilityId: "z", feedstockTypeId: "a" },
    { facilityId: "a", feedstockTypeId: "z" }, { facilityId: "a", feedstockTypeId: "a" }];
  expect(sortProcessScopes(scopes).map(processScopeLockKey)).toEqual([
    "production-process-current:a:a", "production-process-current:a:z", "production-process-current:z:a",
  ]);
});
