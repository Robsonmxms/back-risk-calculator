import { Account, AccountMember } from "../../01-domain/accounts/account";
import { Actor } from "../../01-domain/auth/actor";
import { ApplicationError } from "../errors/application-error";

export function assertAdmin(actor: Actor): void {
  if (actor.role !== "admin") {
    throw new ApplicationError(
      "forbidden",
      "auth.forbidden",
      "You are not allowed to perform this action"
    );
  }
}

export function assertCanReadAccountAnalytics(
  actor: Actor,
  account: Account | undefined,
  membership: AccountMember | undefined
): void {
  if (actor.role === "admin") {
    return;
  }

  if (!account) {
    throw new ApplicationError("not_found", "account.not_found", "Account not found");
  }

  if (account.ownerUserId === actor.id) {
    return;
  }

  if (actor.role === "analyst" && membership?.role === "analyst") {
    return;
  }

  throw new ApplicationError(
    "forbidden",
    "auth.account_access_denied",
    "Account access denied"
  );
}
