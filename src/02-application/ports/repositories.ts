import {
  Account,
  AccountMember,
  AccountMembershipSummary
} from "../../01-domain/accounts/account";
import { User, UserRole } from "../../01-domain/users/user";

export interface CreateUserInput {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: "active" | "disabled";
  passwordHash?: string;
  googleSubject?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRepository {
  create(input: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findByGoogleSubject(googleSubject: string): Promise<User | undefined>;
  linkGoogleSubject(userId: string, googleSubject: string): Promise<User | undefined>;
  list(): Promise<User[]>;
}

export interface AccountRepository {
  findAccountById(id: string): Promise<Account | undefined>;
  listMembershipsForUser(userId: string): Promise<AccountMembershipSummary[]>;
  findMembership(accountId: string, userId: string): Promise<AccountMember | undefined>;
}

export type RefreshTokenRevocationReason =
  | "rotated"
  | "logout"
  | "reuse_detected"
  | "expired";

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  createdAt: Date;
  replacedByTokenId?: string;
  revokedAt?: Date;
  revocationReason?: RefreshTokenRevocationReason;
}

export interface CreateRefreshTokenInput {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface RefreshTokenRepository {
  create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | undefined>;
  markRotated(
    id: string,
    replacedByTokenId: string,
    revokedAt: Date
  ): Promise<RefreshTokenRecord | undefined>;
  revoke(id: string, revokedAt: Date, reason: RefreshTokenRevocationReason): Promise<void>;
  revokeFamily(
    familyId: string,
    revokedAt: Date,
    reason: RefreshTokenRevocationReason
  ): Promise<void>;
}
