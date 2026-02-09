import { describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { createProject } from "@/data-access/projects";

describe("Projects data access", () => {
  it("createProject creates owner membership", async () => {
    const insertedProject = {
      id: "5c5358da-cbf5-48f7-b6d0-724d87cfb2f8",
      name: "My Project",
      description: "Project description",
      ownerId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const projectValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([insertedProject]),
    });
    const membershipValues = vi.fn().mockResolvedValue(undefined);

    const tx = {
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: projectValues })
        .mockReturnValueOnce({ values: membershipValues }),
    };

    const transactionSpy = vi
      .spyOn(db, "transaction")
      .mockImplementation(async (callback) => callback(tx as never));

    const result = await createProject("user-1", {
      name: "My Project",
      description: "Project description",
    });

    expect(result).toEqual(insertedProject);
    expect(transactionSpy).toHaveBeenCalledOnce();
    expect(membershipValues).toHaveBeenCalledWith({
      projectId: insertedProject.id,
      userId: "user-1",
      role: "owner",
    });
  });
});
