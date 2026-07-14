import { randomUUID } from "crypto";
import {
  Account,
  AccountMember,
  AccountMembershipSummary,
  PortfolioAccountSnapshot
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
  readonly portfolioSnapshots = new Map<string, PortfolioAccountSnapshot>();
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

  async listPortfolioSnapshotsForUser(userId: string): Promise<PortfolioAccountSnapshot[]> {
    const memberships = await this.listMembershipsForUser(userId);
    return memberships
      .map((membership) => {
        const snapshot = this.portfolioSnapshots.get(membership.accountId);
        if (!snapshot) {
          return undefined;
        }

        return {
          ...snapshot,
          membershipRole: membership.role,
          accountName: membership.accountName
        };
      })
      .filter((snapshot): snapshot is PortfolioAccountSnapshot => Boolean(snapshot));
  }

  async findPortfolioSnapshotByAccountId(
    accountId: string
  ): Promise<PortfolioAccountSnapshot | undefined> {
    return this.portfolioSnapshots.get(accountId);
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

  addPortfolioSnapshot(snapshot: PortfolioAccountSnapshot): void {
    this.portfolioSnapshots.set(snapshot.accountId, snapshot);
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
  store.addAccount({
    id: "acct_income",
    name: "Income Sleeve",
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
  store.addAccountMember({
    id: randomUUID(),
    accountId: "acct_income",
    userId: "usr_analyst",
    role: "analyst",
    createdAt: now
  });

  store.addPortfolioSnapshot({
    accountId: "acct_main",
    accountName: "Main Portfolio Account",
    membershipRole: "owner",
    currency: "USD",
    marketValue: 245800,
    costBasis: 218100,
    unrealizedPnl: 27700,
    dayChangePercent: 1.4,
    holdingsCount: 4,
    openAlerts: 1,
    reportStatus: "ready",
    analytics: {
      riskScore: 42,
      volatilityPercent: 12.8,
      valueAtRisk95: 18400,
      maxDrawdownPercent: 8.7,
      diversificationScore: 78,
      notes: [
        "Risk score is moderate relative to the current allocation.",
        "Sector concentration remains below the internal alert threshold."
      ]
    },
    allocation: [
      { label: "Equities", weightPercent: 54 },
      { label: "ETFs", weightPercent: 28 },
      { label: "Fixed income", weightPercent: 12 },
      { label: "Cash", weightPercent: 6 }
    ],
    performance: [
      { label: "Jan", returnPercent: 1.2 },
      { label: "Feb", returnPercent: 0.8 },
      { label: "Mar", returnPercent: -0.6 },
      { label: "Apr", returnPercent: 1.4 },
      { label: "May", returnPercent: 0.9 },
      { label: "Jun", returnPercent: 1.1 }
    ],
    holdings: [
      {
        symbol: "MSFT",
        name: "Microsoft",
        assetClass: "Equity",
        quantity: 120,
        weightPercent: 22,
        marketValue: 54000,
        dayChangePercent: 1.6
      },
      {
        symbol: "VTI",
        name: "Vanguard Total Stock Market ETF",
        assetClass: "ETF",
        quantity: 300,
        weightPercent: 28,
        marketValue: 68800,
        dayChangePercent: 0.9
      },
      {
        symbol: "IEF",
        name: "iShares 7-10 Year Treasury Bond ETF",
        assetClass: "Fixed income",
        quantity: 180,
        weightPercent: 12,
        marketValue: 29400,
        dayChangePercent: -0.2
      },
      {
        symbol: "NVDA",
        name: "NVIDIA",
        assetClass: "Equity",
        quantity: 55,
        weightPercent: 18,
        marketValue: 44200,
        dayChangePercent: 2.1
      }
    ],
    transactions: [
      {
        id: "txn_001",
        tradeDate: "2026-07-12",
        type: "buy",
        description: "Added VTI after cash inflow",
        quantity: 25,
        amount: 5750,
        currency: "USD",
        status: "posted"
      },
      {
        id: "txn_002",
        tradeDate: "2026-07-10",
        type: "rebalance",
        description: "Reduced single-name exposure",
        quantity: 12,
        amount: 3980,
        currency: "USD",
        status: "posted"
      },
      {
        id: "txn_003",
        tradeDate: "2026-07-08",
        type: "dividend",
        description: "Quarterly ETF dividend",
        quantity: 0,
        amount: 210,
        currency: "USD",
        status: "posted"
      }
    ],
    reports: [
      {
        id: "rpt_001",
        name: "Monthly risk pack",
        asOf: "2026-07-11T18:30:00.000Z",
        status: "ready",
        format: "pdf"
      },
      {
        id: "rpt_002",
        name: "Exposure export",
        asOf: "2026-07-12T12:00:00.000Z",
        status: "ready",
        format: "csv"
      }
    ],
    alerts: [
      {
        id: "alt_001",
        title: "Single-name concentration nearing watch band",
        severity: "medium",
        status: "monitoring"
      }
    ],
    insights: [
      "Current equity concentration is elevated but still within the internal risk budget.",
      "Cash coverage remains adequate for expected short-term withdrawals."
    ],
    meta: {
      status: "ready",
      freshness: "fresh",
      asOf: "2026-07-14T09:15:00.000Z",
      lastSuccessfulSyncAt: "2026-07-14T09:10:00.000Z",
      warnings: []
    }
  });

  store.addPortfolioSnapshot({
    accountId: "acct_income",
    accountName: "Income Sleeve",
    membershipRole: "analyst",
    currency: "USD",
    marketValue: 128400,
    costBasis: 130900,
    unrealizedPnl: -2500,
    dayChangePercent: 0.3,
    holdingsCount: 3,
    openAlerts: 2,
    reportStatus: "generating",
    analytics: {
      riskScore: 57,
      volatilityPercent: 9.4,
      valueAtRisk95: 9600,
      maxDrawdownPercent: 6.2,
      diversificationScore: 61,
      notes: [
        "Latest factor model run is partial because one market data source is delayed.",
        "Duration exposure is above the target band for this sleeve."
      ]
    },
    allocation: [
      { label: "Fixed income", weightPercent: 58 },
      { label: "Dividend equities", weightPercent: 24 },
      { label: "REITs", weightPercent: 10 },
      { label: "Cash", weightPercent: 8 }
    ],
    performance: [
      { label: "Jan", returnPercent: 0.6 },
      { label: "Feb", returnPercent: 0.4 },
      { label: "Mar", returnPercent: 0.1 },
      { label: "Apr", returnPercent: 0.5 },
      { label: "May", returnPercent: -0.3 },
      { label: "Jun", returnPercent: 0.2 }
    ],
    holdings: [
      {
        symbol: "LQD",
        name: "iShares iBoxx $ Investment Grade Corporate Bond ETF",
        assetClass: "Fixed income",
        quantity: 410,
        weightPercent: 30,
        marketValue: 38500,
        dayChangePercent: 0.1
      },
      {
        symbol: "VNQ",
        name: "Vanguard Real Estate ETF",
        assetClass: "REIT",
        quantity: 160,
        weightPercent: 10,
        marketValue: 12600,
        dayChangePercent: -0.4
      },
      {
        symbol: "SCHD",
        name: "Schwab US Dividend Equity ETF",
        assetClass: "Dividend equity",
        quantity: 290,
        weightPercent: 24,
        marketValue: 30800,
        dayChangePercent: 0.6
      }
    ],
    transactions: [
      {
        id: "txn_101",
        tradeDate: "2026-07-13",
        type: "buy",
        description: "Added SCHD for dividend coverage",
        quantity: 18,
        amount: 1490,
        currency: "USD",
        status: "pending"
      },
      {
        id: "txn_102",
        tradeDate: "2026-07-09",
        type: "sell",
        description: "Reduced long-duration treasury exposure",
        quantity: 22,
        amount: 2415,
        currency: "USD",
        status: "posted"
      }
    ],
    reports: [
      {
        id: "rpt_101",
        name: "Income sleeve monitoring",
        asOf: "2026-07-14T07:45:00.000Z",
        status: "generating",
        format: "pdf"
      }
    ],
    alerts: [
      {
        id: "alt_101",
        title: "Market data refresh delayed for one bond venue",
        severity: "high",
        status: "open"
      },
      {
        id: "alt_102",
        title: "Duration exposure above target band",
        severity: "medium",
        status: "monitoring"
      }
    ],
    insights: [
      "This sleeve is showing stale market inputs for one source, so risk metrics are directional only.",
      "Income concentration is acceptable, but duration risk should be monitored before reallocating."
    ],
    meta: {
      status: "degraded",
      freshness: "partial",
      asOf: "2026-07-13T22:40:00.000Z",
      lastSuccessfulSyncAt: "2026-07-13T18:05:00.000Z",
      warnings: [
        "Fixed-income market data is partially delayed.",
        "Report generation is still running for the latest snapshot."
      ]
    }
  });

  return store;
}
