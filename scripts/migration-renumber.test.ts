import { describe, expect, it } from "vitest";
import { followUpLines, planRenumber } from "./migration-renumber";

const STAGING = [
  { idx: 0, tag: "0000_first", when: 100 },
  { idx: 1, tag: "0001_staging_take", when: 150 },
];

describe("planRenumber", () => {
  it("reports nothing to do when the branch only holds staging's migrations", () => {
    expect(planRenumber(STAGING, STAGING)).toEqual({ branchOnly: [], name: undefined, nextTag: undefined });
  });

  it("moves a colliding branch migration after staging's last one", () => {
    const branch = [STAGING[0], { idx: 1, tag: "0001_mine", when: 200 }];
    expect(planRenumber(STAGING, branch)).toEqual({
      branchOnly: ["0001_mine"],
      name: "mine",
      nextTag: "0002_mine",
    });
  });

  it("names the regenerated migration after the last branch migration", () => {
    const branch = [
      STAGING[0],
      { idx: 1, tag: "0001_a", when: 200 },
      { idx: 2, tag: "0002_b", when: 300 },
    ];
    const plan = planRenumber(STAGING, branch);
    expect(plan.branchOnly).toEqual(["0001_a", "0002_b"]);
    expect(plan.nextTag).toBe("0002_b");
  });
});

describe("followUpLines", () => {
  const DEV = "postgresql://u:secret@localhost:5432/noma_dmrv_wt_mig_renumber_dev";
  const TEST = "postgresql://u:secret@localhost:5432/noma_dmrv_wt_mig_renumber_test";

  it("suggests resets for both worktree DBs without printing credentials", () => {
    const text = followUpLines("/wt/x", DEV, TEST).join("\n");
    expect(text).toContain('cd "/wt/x" && pnpm db:reset');
    expect(text).toContain(". ./.env.test");
    expect(text).not.toContain("secret");
  });

  it.each([
    ["a shared dev DB", "postgresql://u:p@localhost:5432/noma_dmrv_dev"],
    ["a remote host", "postgresql://u:p@db.example.com:5432/noma_dmrv_wt_x_dev"],
    ["garbage", "not a url"],
  ])("suggests nothing for %s", (_label, url) => {
    expect(followUpLines("/wt/x", url, undefined).join("\n")).not.toContain("db:reset");
  });
});
