import { randomUUID } from "crypto";
import {
  Account,
  AccountMember,
  AccountMembershipSummary
} from "../../01-domain/accounts/account";
import { User } from "../../01-domain/users/user";
import {
  AccountRepository,
  CreateRefreshTokenInput,
  CreateUserInput,
  RefreshTokenRecord,
  RefreshTokenRepository,
  RefreshTokenRevocationReason,
  UserRepository
} from "../../02-application/ports/repositories";
import { PasswordHasher } from "../../02-application/ports/security";
import { ScryptPasswordHasher } from "../../03-adapters/security/ScryptPasswordHasher";

export class InMemoryIdentityStore
  implements UserRepository, AccountRepository, RefreshTokenRepository
{
  readonly users = new Map<string, User>();
  readonly accounts = new Map<string, Account>();
  readonly accountMembers = new Map<string, AccountMember>();
  readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  async create(input: CreateUserInput): Promise<User>;
  async create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;
  async create(
    input: CreateUserInput | CreateRefreshTokenInput
  ): Promise<User | RefreshTokenRecord> {
    if ("email" in input) {
      const user: User = { ...input };
      this.users.set(user.id, user);
      return user;
    }

    const refreshToken: RefreshTokenRecord = { ...input };
    this.refreshTokens.set(refreshToken.id, refreshToken);
    return refreshToken;
  }

  async findById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email.toLowerCase() === email.toLowerCase()
    );
  }

  async findByGoogleSubject(googleSubject: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.googleSubject === googleSubject
    );
  }

  async linkGoogleSubject(userId: string, googleSubject: string): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) {
      return undefined;
    }

    user.googleSubject = googleSubject;
    user.updatedAt = new Date();
    return user;
  }

  async list(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async findAccountById(id: string): Promise<Account | undefined> {
    return this.accounts.get(id);
  }

  async findMembership(accountId: string, userId: string): Promise<AccountMember | undefined> {
    return Array.from(this.accountMembers.values()).find(
      (membership) => membership.accountId === accountId && membership.userId === userId
    );
  }

  async listMembershipsForUser(userId: string): Promise<AccountMembershipSummary[]> {
    return Array.from(this.accountMembers.values())
      .filter((membership) => membership.userId === userId)
      .map((membership) => {
        const account = this.accounts.get(membership.accountId);
        return {
          accountId: membership.accountId,
          accountName: account?.name ?? "Unknown account",
          role: membership.role
        };
      });
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    return Array.from(this.refreshTokens.values()).find(
      (token) => token.tokenHash === tokenHash
    );
  }

  async markRotated(
    id: string,
    replacedByTokenId: string,
    revokedAt: Date
  ): Promise<RefreshTokenRecord | undefined> {
    const refreshToken = this.refreshTokens.get(id);
    if (!refreshToken) {
      return undefined;
    }

    refreshToken.replacedByTokenId = replacedByTokenId;
    refreshToken.revokedAt = revokedAt;
    refreshToken.revocationReason = "rotated";
    return refreshToken;
  }

  async revoke(
    id: string,
    revokedAt: Date,
    reason: RefreshTokenRevocationReason
  ): Promise<void> {
    const refreshToken = this.refreshTokens.get(id);
    if (refreshToken) {
      refreshToken.revokedAt = revokedAt;
      refreshToken.revocationReason = reason;
    }
  }

  async revokeFamily(
    familyId: string,
    revokedAt: Date,
    reason: RefreshTokenRevocationReason
  ): Promise<void> {
    for (const refreshToken of this.refreshTokens.values()) {
      if (refreshToken.familyId === familyId) {
        refreshToken.revokedAt = revokedAt;
        refreshToken.revocationReason = reason;
      }
    }
  }

  addAccount(account: Account): void {
    this.accounts.set(account.id, account);
  }

  addAccountMember(member: AccountMember): void {
    this.accountMembers.set(member.id, member);
  }
}

export async function createSeededIdentityStore(
  passwordHasher: PasswordHasher = new ScryptPasswordHasher()
): Promise<InMemoryIdentityStore> {
  const store = new InMemoryIdentityStore();
  const now = new Date("2026-07-09T00:00:00.000Z");
  const passwordHash = await passwordHasher.hash("Password123!");

  const users: User[] = [
    {
      id: "usr_admin",
      email: "admin@example.com",
      name: "Admin User",
      role: "admin",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_analyst",
      email: "analyst@example.com",
      name: "Analyst User",
      role: "analyst",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_user",
      email: "user@example.com",
      name: "Portfolio User",
      role: "user",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_other",
      email: "other@example.com",
      name: "Other User",
      role: "user",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    }
  ];

  for (const user of users) {
    store.users.set(user.id, user);
  }

  store.addAccount({
    id: "acct_main",
    name: "Main Portfolio Account",
    ownerUserId: "usr_user",
    createdAt: now,
    updatedAt: now
  });
  store.addAccount({
    id: "acct_private",
    name: "Private Account",
    ownerUserId: "usr_other",
    createdAt: now,
    updatedAt: now
  });

  store.addAccountMember({
    id: randomUUID(),
    accountId: "acct_main",
    userId: "usr_user",
    role: "owner",
    createdAt: now
  });
  store.addAccountMember({
    id: randomUUID(),
    accountId: "acct_main",
    userId: "usr_analyst",
    role: "analyst",
    createdAt: now
  });
  store.addAccountMember({
    id: randomUUID(),
    accountId: "acct_private",
    userId: "usr_other",
    role: "owner",
    createdAt: now
  });

  return store;
}
