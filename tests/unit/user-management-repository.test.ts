import { describe, expect, it } from "vitest";
import { User } from "../../src/01-domain/users/user";
import { InMemoryIdentityStore } from "../../src/04-infra/repositories/InMemoryIdentityStore";

const now = new Date("2026-08-11T12:00:00.000Z");

describe("in-memory user management atomic guards", () => {
  it("keeps one active administrator under concurrent demotions", async () => {
    const store = new InMemoryIdentityStore();
    store.users.set("admin-a", user("admin-a", "a@example.invalid", "admin"));
    store.users.set("admin-b", user("admin-b", "b@example.invalid", "admin"));

    const results = await Promise.all([
      store.updateManagedUser("admin-a", { role: "analyst", updatedAt: now }),
      store.updateManagedUser("admin-b", { status: "disabled", updatedAt: now })
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "last_active_admin_required",
      "updated"
    ]);
    expect(
      Array.from(store.users.values()).filter(
        (entry) => entry.role === "admin" && entry.status === "active"
      )
    ).toHaveLength(1);
  });

  it("normalizes email and prevents concurrent duplicate identities", async () => {
    const first = user("first", "duplicate@example.invalid", "user");
    const second = user("second", "DUPLICATE@example.invalid", "user");
    const store = new InMemoryIdentityStore();

    const results = await Promise.all([
      store.createManagedUser(first),
      store.createManagedUser(second)
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(store.users.size).toBe(1);
  });
});

function user(id: string, email: string, role: User["role"]): User {
  return {
    id,
    email,
    name: id,
    role,
    status: "active",
    passwordHash: "hash",
    createdAt: now,
    updatedAt: now
  };
}
