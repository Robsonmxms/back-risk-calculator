import { UserRole } from "./user";

export const USER_MANAGEMENT_ROLES: readonly UserRole[] = Object.freeze([
  "admin",
  "analyst",
  "user"
]);

const manageableRoles: Readonly<Record<UserRole, readonly UserRole[]>> = Object.freeze({
  admin: USER_MANAGEMENT_ROLES,
  analyst: Object.freeze(["user"] as const),
  user: Object.freeze([] as const)
});

export function canManageAnyUser(actorRole: UserRole): boolean {
  return manageableRoles[actorRole].length > 0;
}

export function canManageUserRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return manageableRoles[actorRole].includes(targetRole);
}
