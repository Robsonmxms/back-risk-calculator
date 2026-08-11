import { Actor } from "../../01-domain/auth/actor";
import { canManageAnyUser, canManageUserRole } from "../../01-domain/users/user-management-policy";
import { UserRole } from "../../01-domain/users/user";
import { ApplicationError } from "../errors/application-error";

export function assertUserManager(actor: Actor): void {
  if (!canManageAnyUser(actor.role)) {
    throw new ApplicationError(
      "forbidden",
      "user.management_forbidden",
      "User management is not allowed"
    );
  }
}

export function assertTargetRole(actor: Actor, targetRole: UserRole): void {
  assertUserManager(actor);
  if (!canManageUserRole(actor.role, targetRole)) {
    throw new ApplicationError(
      "forbidden",
      "user.target_role_forbidden",
      "The requested user role is outside your management scope"
    );
  }
}

export function assertResultingRole(actor: Actor, resultingRole: UserRole): void {
  assertUserManager(actor);
  if (!canManageUserRole(actor.role, resultingRole)) {
    throw new ApplicationError(
      "forbidden",
      "user.resulting_role_forbidden",
      "The resulting user role is outside your management scope"
    );
  }
}

export function assertNotSelfManagement(actor: Actor, targetId: string): void {
  assertUserManager(actor);
  if (actor.id === targetId) {
    throw new ApplicationError(
      "forbidden",
      "user.self_management_forbidden",
      "You cannot edit your own account in this flow"
    );
  }
}
