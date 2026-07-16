import { AccountMembershipSummary } from "../accounts/account";
import { OfficeMembershipSummary } from "../offices/office";
import { SafeUser, UserRole } from "../users/user";

export interface Actor {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  officeMemberships: OfficeMembershipSummary[];
  accountMemberships: AccountMembershipSummary[];
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  actor: Actor;
}

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  email: string;
}

export interface CurrentUserResponse {
  actor: Actor;
  user: SafeUser;
}
