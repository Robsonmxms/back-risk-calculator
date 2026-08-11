import { describe, expect, it } from "vitest";
import {
  canManageAnyUser,
  canManageUserRole,
  USER_MANAGEMENT_ROLES
} from "../../src/01-domain/users/user-management-policy";

describe("global user management policy", () => {
  it.each([
    ["admin", "admin", true],
    ["admin", "analyst", true],
    ["admin", "user", true],
    ["analyst", "admin", false],
    ["analyst", "analyst", false],
    ["analyst", "user", true],
    ["user", "admin", false],
    ["user", "analyst", false],
    ["user", "user", false]
  ] as const)("allows %s to manage %s: %s", (actor, target, expected) => {
    expect(canManageUserRole(actor, target)).toBe(expected);
  });

  it("keeps the hierarchy source-controlled and immutable", () => {
    expect(USER_MANAGEMENT_ROLES).toEqual(["admin", "analyst", "user"]);
    expect(Object.isFrozen(USER_MANAGEMENT_ROLES)).toBe(true);
    expect(canManageAnyUser("admin")).toBe(true);
    expect(canManageAnyUser("analyst")).toBe(true);
    expect(canManageAnyUser("user")).toBe(false);
  });
});
