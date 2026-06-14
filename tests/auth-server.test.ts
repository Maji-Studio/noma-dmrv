import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  getBetterAuthSession: vi.fn(),
  mapBetterAuthUser: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock("@/lib/auth/providers/better-auth-server", () => ({
  getBetterAuthSession: mocks.getBetterAuthSession,
  mapBetterAuthUser: mocks.mapBetterAuthUser,
  signOut: vi.fn(),
}));

import { getUser } from "@/lib/auth/server";

const sessionUser = {
  id: "stale-user-id",
  email: "stale@example.test",
  name: "Stale Session",
  role: "admin",
  emailVerified: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const databaseUser = {
  id: "fresh-user-id",
  email: "fresh@example.test",
  name: "Fresh User",
  role: "user",
  emailVerified: false,
  createdAt: new Date("2026-01-02T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

const mappedDatabaseUser = {
  ...databaseUser,
  role: "user" as const,
};

describe("getUser", () => {
  beforeEach(() => {
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockResolvedValue([]);
    mocks.mapBetterAuthUser.mockReturnValue(mappedDatabaseUser);
  });

  it("returns null when there is no authenticated session", async () => {
    mocks.getBetterAuthSession.mockResolvedValue(null);

    await expect(getUser()).resolves.toBeNull();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("returns null when the session user no longer exists", async () => {
    mocks.getBetterAuthSession.mockResolvedValue({ user: sessionUser });
    mocks.limit.mockResolvedValue([]);

    await expect(getUser()).resolves.toBeNull();
    expect(mocks.mapBetterAuthUser).not.toHaveBeenCalled();
  });

  it("maps the current database user instead of trusting the session payload", async () => {
    mocks.getBetterAuthSession.mockResolvedValue({ user: sessionUser });
    mocks.limit.mockResolvedValue([databaseUser]);

    await expect(getUser()).resolves.toEqual(mappedDatabaseUser);
    expect(mocks.mapBetterAuthUser).toHaveBeenCalledWith(databaseUser);
  });
});
