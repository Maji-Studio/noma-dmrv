import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

vi.mock("./with-action", () => ({ withAction: async (callback: (ctx: ReturnType<typeof makeTestOrgContext>) => Promise<unknown>) =>
  ({ success: true, data: await callback(makeTestOrgContext()) }) }));
vi.mock("@/data-access/emission-line-comments", () => ({ setEmissionLineComment: vi.fn(), deleteEmissionLineComment: vi.fn() }));
import { setEmissionLineComment, deleteEmissionLineComment } from "@/data-access/emission-line-comments";
import { setEmissionLineCommentFn, deleteEmissionLineCommentFn } from "./emission-line-comments";

const id = "00000000-0000-4000-8000-000000000001";
const input = { facilityId: id, creditBatchId: id, componentId: "line", body: "  Comment  " };
beforeEach(() => vi.clearAllMocks());

it("uses the server organization and validates before calling the store", async () => {
  vi.mocked(setEmissionLineComment).mockResolvedValue({ id, body: "Comment", version: 1 } as never);
  expect(await setEmissionLineCommentFn({ ...input, organizationId: "foreign" } as typeof input))
    .toMatchObject({ success: true, data: { id, body: "Comment", version: 1 } });
  expect(setEmissionLineComment).toHaveBeenCalledExactlyOnceWith(makeTestOrgContext(), { ...input, body: "Comment" });
  await expect(setEmissionLineCommentFn({ ...input, body: " " })).rejects.toThrow();
  expect(setEmissionLineComment).toHaveBeenCalledTimes(1);
});

it("requires the facility and loaded version on delete", async () => {
  const deletion = { facilityId: id, id, expectedVersion: 2 };
  vi.mocked(deleteEmissionLineComment).mockResolvedValue({ id });
  expect(await deleteEmissionLineCommentFn(deletion)).toEqual({ success: true, data: { id } });
  expect(deleteEmissionLineComment).toHaveBeenCalledExactlyOnceWith(makeTestOrgContext(), deletion);
  await expect(deleteEmissionLineCommentFn({ ...deletion, expectedVersion: 0 })).rejects.toThrow();
  expect(deleteEmissionLineComment).toHaveBeenCalledTimes(1);
});
