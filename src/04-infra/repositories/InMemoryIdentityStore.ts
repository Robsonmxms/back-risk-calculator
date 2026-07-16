import { randomUUID } from "crypto";
import {
  Account,
  AccountMember,
  AccountMembershipSummary,
  PortfolioAccountSnapshot
} from "../../01-domain/accounts/account";
import {
  AdvisoryAssignment,
  AdvisoryTeam,
  AdvisoryTeamMember,
  AdvisoryTeamSummary,
  AssignmentResourceType
} from "../../01-domain/advisory/advisory-team";
import {
  Portfolio,
  PortfolioDetail,
  PortfolioOutboxEvent,
  PortfolioPosition,
  PortfolioSnapshot,
  PortfolioSummary,
  PortfolioTransaction
} from "../../01-domain/portfolios/portfolio";
import {
  Office,
  OfficeMembership,
  OfficeMembershipSummary
} from "../../01-domain/offices/office";
import { User } from "../../01-domain/users/user";
import {
  AccountRepository,
  AdvisoryTeamRepository,
  CreateAdvisoryAssignmentInput,
  CreateAdvisoryTeamInput,
  CreatePortfolioInput,
  CreatePortfolioTransactionInput,
  CreateRefreshTokenInput,
  CreateUserInput,
  OfficeRepository,
  PortfolioRepository,
  PortfolioTransactionIdempotencyRecord,
  RefreshTokenRecord,
  RefreshTokenRepository,
  RefreshTokenRevocationReason,
  UpdateAdvisoryTeamInput,
  UpdatePortfolioInput,
  UserRepository
} from "../../02-application/ports/repositories";
import { ApplicationError } from "../../02-application/errors/application-error";
import { ROLE_PERMISSION_MATRIX } from "../../02-application/auth/permission-service";
import { PasswordHasher } from "../../02-application/ports/security";
import { ScryptPasswordHasher } from "../../03-adapters/security/ScryptPasswordHasher";
import { AnalyticsPortfolioProjection } from "../../modules/analytics/ports";
import { PortfolioMarketDataProjection } from "../../modules/market-data/ports";

interface PortfolioRuntimeMeta {
  status: "ready" | "syncing" | "degraded";
  freshness: "fresh" | "partial" | "stale";
  analyticsState: "ready" | "pending";
  marketDataState: "ready" | "pending";
  warnings: string[];
}

export class InMemoryIdentityStore
  implements
    UserRepository,
    AccountRepository,
    OfficeRepository,
    AdvisoryTeamRepository,
    RefreshTokenRepository,
    PortfolioRepository,
    PortfolioMarketDataProjection,
    AnalyticsPortfolioProjection
{
  readonly users = new Map<string, User>();
  readonly offices = new Map<string, Office>();
  readonly officeMembers = new Map<string, OfficeMembership>();
  readonly advisoryTeams = new Map<string, AdvisoryTeam>();
  readonly advisoryTeamMembers = new Map<string, AdvisoryTeamMember>();
  readonly advisoryAssignments = new Map<string, AdvisoryAssignment>();
  readonly accounts = new Map<string, Account>();
  readonly accountMembers = new Map<string, AccountMember>();
  readonly portfolioSnapshots = new Map<string, PortfolioAccountSnapshot>();
  readonly portfolios = new Map<string, Portfolio>();
  readonly portfolioTransactions = new Map<string, PortfolioTransaction[]>();
  readonly ledgerSnapshots = new Map<string, PortfolioSnapshot[]>();
  readonly portfolioRuntimeMeta = new Map<string, PortfolioRuntimeMeta>();
  readonly transactionIdempotency = new Map<string, PortfolioTransactionIdempotencyRecord>();
  readonly outboxEvents: PortfolioOutboxEvent[] = [];
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
          officeId: account?.officeId ?? "ofc_unknown",
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

  async listOfficesForUser(
    userId: string,
    isAdmin: boolean
  ): Promise<OfficeMembershipSummary[]> {
    const visibleOfficeIds = isAdmin
      ? new Set(this.offices.keys())
      : new Set(
          Array.from(this.officeMembers.values())
            .filter((membership) => membership.userId === userId)
            .map((membership) => membership.officeId)
        );

    return Array.from(visibleOfficeIds)
      .map((officeId) => {
        const office = this.offices.get(officeId);
        if (!office) {
          return undefined;
        }
        const membership = Array.from(this.officeMembers.values()).find(
          (entry) => entry.officeId === officeId && entry.userId === userId
        );
        return {
          officeId,
          officeName: office.name,
          role: membership?.role ?? "office_admin"
        };
      })
      .filter((entry): entry is OfficeMembershipSummary => Boolean(entry))
      .sort((left, right) => left.officeName.localeCompare(right.officeName));
  }

  async findOfficeById(officeId: string): Promise<Office | undefined> {
    const office = this.offices.get(officeId);
    return office ? { ...office } : undefined;
  }

  async findOfficeMembership(
    officeId: string,
    userId: string
  ): Promise<OfficeMembership | undefined> {
    const membership = Array.from(this.officeMembers.values()).find(
      (entry) => entry.officeId === officeId && entry.userId === userId
    );
    return membership ? { ...membership } : undefined;
  }

  async listOfficeMembers(officeId: string): Promise<Array<OfficeMembership & {
    userName: string;
    userEmail: string;
  }>> {
    return Array.from(this.officeMembers.values())
      .filter((membership) => membership.officeId === officeId)
      .map((membership) => {
        const user = this.users.get(membership.userId);
        return {
          ...membership,
          userName: user?.name ?? "Unknown user",
          userEmail: user?.email ?? "unknown@example.com"
        };
      })
      .sort((left, right) => left.userName.localeCompare(right.userName));
  }

  async updateOffice(
    officeId: string,
    input: Partial<Pick<Office, "name" | "status" | "updatedAt">>
  ): Promise<Office | undefined> {
    const office = this.offices.get(officeId);
    if (!office) {
      return undefined;
    }

    if (input.name !== undefined) {
      office.name = input.name;
    }
    if (input.status !== undefined) {
      office.status = input.status;
    }
    if (input.updatedAt !== undefined) {
      office.updatedAt = input.updatedAt;
    }
    return { ...office };
  }

  async listTeamsByOffice(officeId: string): Promise<AdvisoryTeamSummary[]> {
    return Array.from(this.advisoryTeams.values())
      .filter((team) => team.officeId === officeId)
      .map((team) => this.toTeamSummary(team))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async findTeamById(teamId: string): Promise<AdvisoryTeam | undefined> {
    const team = this.advisoryTeams.get(teamId);
    return team ? { ...team } : undefined;
  }

  async createTeam(input: CreateAdvisoryTeamInput): Promise<AdvisoryTeamSummary> {
    const team: AdvisoryTeam = {
      id: input.id,
      officeId: input.officeId,
      name: input.name,
      description: input.description,
      status: "active",
      createdAt: input.createdAt,
      updatedAt: input.updatedAt
    };
    this.advisoryTeams.set(team.id, team);
    this.replaceTeamMembers(team, input.memberUserIds, input.createdAt);
    this.pushEvent("AdvisoryTeamCreated", team.id, {
      officeId: team.officeId,
      teamId: team.id
    });
    return this.toTeamSummary(team);
  }

  async updateTeam(
    teamId: string,
    input: UpdateAdvisoryTeamInput
  ): Promise<AdvisoryTeamSummary | undefined> {
    const team = this.advisoryTeams.get(teamId);
    if (!team) {
      return undefined;
    }

    if (input.name !== undefined) {
      team.name = input.name;
    }
    if (input.description !== undefined) {
      team.description = input.description;
    }
    if (input.status !== undefined) {
      team.status = input.status;
    }
    team.updatedAt = input.updatedAt;
    if (input.memberUserIds) {
      this.replaceTeamMembers(team, input.memberUserIds, input.updatedAt);
    }
    this.pushEvent("AdvisoryTeamUpdated", team.id, {
      officeId: team.officeId,
      teamId: team.id
    });
    return this.toTeamSummary(team);
  }

  async listAssignmentsByOffice(officeId: string): Promise<AdvisoryAssignment[]> {
    return Array.from(this.advisoryAssignments.values())
      .filter((assignment) => assignment.officeId === officeId)
      .map((assignment) => ({ ...assignment, permissions: [...assignment.permissions] }))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async listAssignmentsForUser(userId: string, officeId: string): Promise<AdvisoryAssignment[]> {
    const teamIds = new Set(
      Array.from(this.advisoryTeamMembers.values())
        .filter((member) => member.officeId === officeId && member.userId === userId)
        .map((member) => member.teamId)
    );

    return Array.from(this.advisoryAssignments.values())
      .filter(
        (assignment) =>
          assignment.officeId === officeId &&
          !assignment.revokedAt &&
          (assignment.assigneeUserId === userId ||
            (assignment.teamId ? teamIds.has(assignment.teamId) : false))
      )
      .map((assignment) => ({ ...assignment, permissions: [...assignment.permissions] }));
  }

  async listAssignmentsForResource(
    resourceType: AssignmentResourceType,
    resourceId: string
  ): Promise<AdvisoryAssignment[]> {
    return Array.from(this.advisoryAssignments.values())
      .filter(
        (assignment) =>
          assignment.resourceType === resourceType && assignment.resourceId === resourceId
      )
      .map((assignment) => ({ ...assignment, permissions: [...assignment.permissions] }));
  }

  async findAssignmentById(assignmentId: string): Promise<AdvisoryAssignment | undefined> {
    const assignment = this.advisoryAssignments.get(assignmentId);
    return assignment ? { ...assignment, permissions: [...assignment.permissions] } : undefined;
  }

  async createAssignment(input: CreateAdvisoryAssignmentInput): Promise<AdvisoryAssignment> {
    const assignment: AdvisoryAssignment = {
      ...input,
      permissions: [...new Set(input.permissions)]
    };
    this.advisoryAssignments.set(assignment.id, assignment);
    this.pushEvent("AdvisoryAssignmentCreated", assignment.id, {
      officeId: assignment.officeId,
      assignmentId: assignment.id,
      resourceType: assignment.resourceType,
      resourceId: assignment.resourceId
    });
    return { ...assignment, permissions: [...assignment.permissions] };
  }

  async revokeAssignment(
    assignmentId: string,
    revokedAt: Date
  ): Promise<AdvisoryAssignment | undefined> {
    const assignment = this.advisoryAssignments.get(assignmentId);
    if (!assignment) {
      return undefined;
    }

    assignment.revokedAt = revokedAt;
    this.pushEvent("AdvisoryAssignmentRevoked", assignment.id, {
      officeId: assignment.officeId,
      assignmentId: assignment.id
    });
    return { ...assignment, permissions: [...assignment.permissions] };
  }

  async createPortfolio(input: CreatePortfolioInput): Promise<Portfolio> {
    const portfolio: Portfolio = { ...input };
    this.portfolios.set(portfolio.id, portfolio);
    this.portfolioTransactions.set(portfolio.id, []);
    this.portfolioRuntimeMeta.set(portfolio.id, {
      status: "ready",
      freshness: "fresh",
      analyticsState: "ready",
      marketDataState: "ready",
      warnings: []
    });
    this.rebuildSnapshots(portfolio.id);
    this.pushEvent("PortfolioCreated", portfolio.id, {
      officeId: portfolio.officeId,
      portfolioId: portfolio.id,
      accountId: portfolio.accountId
    });
    return portfolio;
  }

  async updatePortfolio(id: string, input: UpdatePortfolioInput): Promise<Portfolio | undefined> {
    const portfolio = this.portfolios.get(id);
    if (!portfolio) {
      return undefined;
    }

    if (input.name) {
      portfolio.name = input.name;
    }
    portfolio.description = input.description;
    portfolio.updatedAt = input.updatedAt;
    this.pushEvent("PortfolioUpdated", portfolio.id, {
      officeId: portfolio.officeId,
      portfolioId: portfolio.id
    });
    return portfolio;
  }

  async findPortfolioById(id: string): Promise<Portfolio | undefined> {
    return this.portfolios.get(id);
  }

  async listVisiblePortfolios(userId: string, isAdmin: boolean): Promise<PortfolioSummary[]> {
    const memberships = await this.listMembershipsForUser(userId);
    const membershipByAccountId = new Map(memberships.map((entry) => [entry.accountId, entry]));

    return Array.from(this.portfolios.values())
      .filter((portfolio) => {
        const account = this.accounts.get(portfolio.accountId);
        return Boolean(
          account &&
            (isAdmin ||
              account.ownerUserId === userId ||
              membershipByAccountId.has(portfolio.accountId) ||
              this.userHasOfficePermission(userId, account.officeId, "ledger.read"))
        );
      })
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((portfolio) => this.toPortfolioSummary(portfolio, userId, isAdmin))
      .sort((left, right) =>
        (right.lastTransactionDate ?? "").localeCompare(left.lastTransactionDate ?? "")
      );
  }

  async findVisiblePortfolioDetail(
    portfolioId: string,
    userId: string,
    isAdmin: boolean
  ): Promise<PortfolioDetail | undefined> {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return undefined;
    }

    const account = this.accounts.get(portfolio.accountId);
    const membership = await this.findMembership(portfolio.accountId, userId);
    if (!account) {
      return undefined;
    }

    if (
      !isAdmin &&
      account.ownerUserId !== userId &&
      !membership &&
      !this.userHasOfficePermission(userId, account.officeId, "ledger.read")
    ) {
      return undefined;
    }

    const summary = this.toPortfolioSummary(portfolio, userId, isAdmin);
    const meta = this.portfolioRuntimeMeta.get(portfolioId);
    return {
      ...summary,
      createdAt: portfolio.createdAt.toISOString(),
      updatedAt: portfolio.updatedAt.toISOString(),
      warnings: meta?.warnings ?? []
    };
  }

  async listPortfolioTransactions(portfolioId: string): Promise<PortfolioTransaction[]> {
    return [...(this.portfolioTransactions.get(portfolioId) ?? [])].sort((left, right) => {
      return right.tradeDate.localeCompare(left.tradeDate) || right.createdAt.getTime() - left.createdAt.getTime();
    });
  }

  async createPortfolioTransaction(
    input: CreatePortfolioTransactionInput
  ): Promise<PortfolioTransaction> {
    const portfolio = this.portfolios.get(input.portfolioId);
    if (!portfolio) {
      throw new ApplicationError("not_found", "portfolio.not_found", "Portfolio not found");
    }

    const transactions = [...(this.portfolioTransactions.get(input.portfolioId) ?? [])];
    const positionMap = this.buildPositionMap(input.portfolioId);
    const existingPosition = positionMap.get(input.assetSymbol);

    if (input.type === "sell" && (existingPosition?.quantity ?? 0) < input.quantity) {
      throw new ApplicationError(
        "invalid",
        "portfolio.negative_position",
        "Sell transaction would create a negative position"
      );
    }

    const transaction: PortfolioTransaction = { ...input };
    transactions.push(transaction);
    this.portfolioTransactions.set(input.portfolioId, transactions);
    if (input.idempotencyKey) {
      this.transactionIdempotency.set(
        this.getIdempotencyIndex(input.portfolioId, input.idempotencyKey),
        {
          transaction,
          requestFingerprint: input.idempotencyFingerprint ?? ""
        }
      );
    }

    portfolio.updatedAt = input.createdAt;
    this.portfolioRuntimeMeta.set(input.portfolioId, {
      status: "syncing",
      freshness: "partial",
      analyticsState: "pending",
      marketDataState: "pending",
      warnings: [
        "Analytics recomputation pending after the latest ledger change.",
        "Market data refresh pending for affected assets."
      ]
    });
    this.rebuildSnapshots(input.portfolioId);
    this.pushEvent("TransactionRecorded", transaction.id, {
      officeId: portfolio.officeId,
      portfolioId: transaction.portfolioId,
      transactionId: transaction.id
    });
    this.pushEvent("PositionProjectionUpdated", transaction.portfolioId, {
      officeId: portfolio.officeId,
      portfolioId: transaction.portfolioId
    });
    this.pushEvent("PortfolioSnapshotCreated", transaction.portfolioId, {
      officeId: portfolio.officeId,
      portfolioId: transaction.portfolioId
    });
    this.pushEvent("AnalyticsRequested", transaction.portfolioId, {
      officeId: portfolio.officeId,
      portfolioId: transaction.portfolioId
    });
    this.pushEvent("MarketDataRequested", transaction.portfolioId, {
      officeId: portfolio.officeId,
      portfolioId: transaction.portfolioId
    });

    return transaction;
  }

  async findTransactionIdempotencyRecord(
    portfolioId: string,
    idempotencyKey: string
  ): Promise<PortfolioTransactionIdempotencyRecord | undefined> {
    return this.transactionIdempotency.get(this.getIdempotencyIndex(portfolioId, idempotencyKey));
  }

  async listPortfolioPositions(
    portfolioId: string,
    asOfDate?: string
  ): Promise<PortfolioPosition[]> {
    return Array.from(this.buildPositionMap(portfolioId, asOfDate).values()).sort((left, right) =>
      left.assetSymbol.localeCompare(right.assetSymbol)
    );
  }

  async listPortfolioSnapshots(portfolioId: string): Promise<PortfolioSnapshot[]> {
    return [...(this.ledgerSnapshots.get(portfolioId) ?? [])].sort((left, right) =>
      right.asOfDate.localeCompare(left.asOfDate)
    );
  }

  async listOutboxEvents(): Promise<PortfolioOutboxEvent[]> {
    return [...this.outboxEvents];
  }

  async listTrackedAssetSymbols(): Promise<string[]> {
    const symbols = new Set<string>();
    for (const portfolio of this.portfolios.values()) {
      for (const position of this.buildPositionMap(portfolio.id).values()) {
        symbols.add(position.assetSymbol);
      }
    }

    return Array.from(symbols).sort((left, right) => left.localeCompare(right));
  }

  async listPortfolioIdsHoldingAsset(symbol: string): Promise<string[]> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    return Array.from(this.portfolios.values())
      .filter((portfolio) => this.buildPositionMap(portfolio.id).has(normalizedSymbol))
      .map((portfolio) => portfolio.id);
  }

  async markMarketDataRefreshSucceeded(symbol: string, _refreshedAt: Date): Promise<void> {
    for (const portfolioId of await this.listPortfolioIdsHoldingAsset(symbol)) {
      const meta = this.portfolioRuntimeMeta.get(portfolioId);
      if (!meta) {
        continue;
      }

      meta.marketDataState = "ready";
      meta.status = meta.analyticsState === "pending" ? "syncing" : "ready";
      meta.freshness = meta.analyticsState === "pending" ? "partial" : "fresh";
      meta.warnings = meta.warnings.filter(
        (warning) => !warning.toLowerCase().includes("market data")
      );
      if (meta.analyticsState === "pending" && meta.warnings.length === 0) {
        meta.warnings.push("Analytics recomputation pending after the latest market data update.");
      }
    }
  }

  async markMarketDataRefreshFailed(
    symbol: string,
    errorCode: string,
    _failedAt: Date
  ): Promise<void> {
    for (const portfolioId of await this.listPortfolioIdsHoldingAsset(symbol)) {
      const meta = this.portfolioRuntimeMeta.get(portfolioId);
      if (!meta) {
        continue;
      }

      meta.marketDataState = "pending";
      meta.status = "degraded";
      meta.freshness = "stale";
      meta.warnings = [
        `Market data refresh failed (${errorCode}); last known good data was preserved.`
      ];
    }
  }

  async markAnalyticsSucceeded(portfolioId: string, _refreshedAt: Date): Promise<void> {
    const meta = this.portfolioRuntimeMeta.get(portfolioId);
    if (!meta) {
      return;
    }

    meta.analyticsState = "ready";
    meta.status = meta.marketDataState === "pending" ? "syncing" : "ready";
    meta.freshness = meta.marketDataState === "pending" ? "partial" : "fresh";
    meta.warnings = meta.warnings.filter(
      (warning) => !warning.toLowerCase().includes("analytics")
    );
    if (meta.marketDataState === "pending" && meta.warnings.length === 0) {
      meta.warnings.push("Market data refresh pending for affected assets.");
    }
  }

  async markAnalyticsFailed(
    portfolioId: string,
    errorCode: string,
    _failedAt: Date
  ): Promise<void> {
    const meta = this.portfolioRuntimeMeta.get(portfolioId);
    if (!meta) {
      return;
    }

    meta.analyticsState = "pending";
    meta.status = "degraded";
    meta.freshness = "stale";
    meta.warnings = [
      `Analytics recomputation failed (${errorCode}); last successful snapshot remains available.`
    ];
  }

  async appendOutboxEvent(
    topic: string,
    aggregateId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    this.pushEvent(topic, aggregateId, payload);
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

  addLedgerPortfolio(
    portfolio: Portfolio,
    meta: PortfolioRuntimeMeta,
    transactions: Omit<PortfolioTransaction, "portfolioId">[]
  ): void {
    this.portfolios.set(portfolio.id, portfolio);
    this.portfolioRuntimeMeta.set(portfolio.id, meta);
    this.portfolioTransactions.set(
      portfolio.id,
      transactions.map((transaction) => ({
        ...transaction,
        portfolioId: portfolio.id
      }))
    );
    this.rebuildSnapshots(portfolio.id);
  }

  private userHasOfficePermission(
    userId: string,
    officeId: string,
    permission: "ledger.read"
  ): boolean {
    const membership = Array.from(this.officeMembers.values()).find(
      (entry) => entry.officeId === officeId && entry.userId === userId
    );
    return membership ? ROLE_PERMISSION_MATRIX[membership.role].includes(permission) : false;
  }

  private toTeamSummary(team: AdvisoryTeam): AdvisoryTeamSummary {
    const members = Array.from(this.advisoryTeamMembers.values())
      .filter((member) => member.teamId === team.id)
      .map((member) => {
        const user = this.users.get(member.userId);
        return {
          ...member,
          userName: user?.name ?? "Unknown user",
          userEmail: user?.email ?? "unknown@example.com"
        };
      })
      .sort((left, right) => left.userName.localeCompare(right.userName));

    return {
      ...team,
      members
    };
  }

  private replaceTeamMembers(
    team: AdvisoryTeam,
    memberUserIds: string[],
    createdAt: Date
  ): void {
    for (const [id, member] of this.advisoryTeamMembers.entries()) {
      if (member.teamId === team.id) {
        this.advisoryTeamMembers.delete(id);
      }
    }

    for (const userId of new Set(memberUserIds)) {
      const officeMembership = Array.from(this.officeMembers.values()).find(
        (membership) => membership.officeId === team.officeId && membership.userId === userId
      );
      if (!officeMembership) {
        continue;
      }

      const member: AdvisoryTeamMember = {
        id: randomUUID(),
        officeId: team.officeId,
        teamId: team.id,
        userId,
        role: officeMembership.role,
        createdAt
      };
      this.advisoryTeamMembers.set(member.id, member);
    }
  }

  private toPortfolioSummary(
    portfolio: Portfolio,
    userId: string,
    isAdmin: boolean
  ): PortfolioSummary {
    const account = this.accounts.get(portfolio.accountId);
    const membership = Array.from(this.accountMembers.values()).find(
      (entry) => entry.accountId === portfolio.accountId && entry.userId === userId
    );
    const positions = Array.from(this.buildPositionMap(portfolio.id).values());
    const transactions = [...(this.portfolioTransactions.get(portfolio.id) ?? [])].sort(
      (left, right) =>
        right.tradeDate.localeCompare(left.tradeDate) ||
        right.createdAt.getTime() - left.createdAt.getTime()
    );
    const totalCostBasis = Number(
      positions.reduce((sum, position) => sum + position.totalCostBasis, 0).toFixed(2)
    );
    const meta = this.portfolioRuntimeMeta.get(portfolio.id) ?? {
      status: "ready",
      freshness: "fresh",
      analyticsState: "ready",
      marketDataState: "ready",
      warnings: []
    };

    return {
      id: portfolio.id,
      officeId: portfolio.officeId,
      accountId: portfolio.accountId,
      accountName: account?.name ?? "Unknown account",
      name: portfolio.name,
      description: portfolio.description,
      baseCurrency: portfolio.baseCurrency,
      membershipRole: membership?.role ?? (isAdmin ? "owner" : account?.ownerUserId === userId ? "owner" : "viewer"),
      holdingsCount: positions.length,
      transactionCount: transactions.length,
      totalCostBasis,
      freshness: meta.freshness,
      status: meta.status,
      analyticsState: meta.analyticsState,
      marketDataState: meta.marketDataState,
      lastTransactionDate: transactions[0]?.tradeDate
    };
  }

  private getIdempotencyIndex(portfolioId: string, key: string): string {
    return `${portfolioId}:${key}`;
  }

  private buildPositionMap(
    portfolioId: string,
    asOfDate?: string
  ): Map<string, PortfolioPosition> {
    const positionMap = new Map<string, PortfolioPosition>();
    const transactions = [...(this.portfolioTransactions.get(portfolioId) ?? [])]
      .filter((transaction) => !asOfDate || transaction.tradeDate <= asOfDate)
      .sort((left, right) => {
        return left.tradeDate.localeCompare(right.tradeDate) || left.createdAt.getTime() - right.createdAt.getTime();
      });

    for (const transaction of transactions) {
      const current = positionMap.get(transaction.assetSymbol) ?? {
        portfolioId,
        assetSymbol: transaction.assetSymbol,
        assetName: transaction.assetName,
        quantity: 0,
        averageCost: 0,
        totalCostBasis: 0,
        currency: transaction.currency,
        lastTransactionDate: transaction.tradeDate
      };

      if (transaction.type === "buy") {
        current.quantity = Number((current.quantity + transaction.quantity).toFixed(8));
        current.totalCostBasis = Number(
          (current.totalCostBasis + transaction.totalAmount).toFixed(2)
        );
      } else {
        if (current.quantity < transaction.quantity) {
          throw new ApplicationError(
            "invalid",
            "portfolio.negative_position",
            "Sell transaction would create a negative position"
          );
        }

        const averageCost = current.quantity === 0 ? 0 : current.totalCostBasis / current.quantity;
        current.quantity = Number((current.quantity - transaction.quantity).toFixed(8));
        current.totalCostBasis = Number(
          (current.totalCostBasis - averageCost * transaction.quantity).toFixed(2)
        );
      }

      current.averageCost =
        current.quantity === 0 ? 0 : Number((current.totalCostBasis / current.quantity).toFixed(2));
      current.lastTransactionDate = transaction.tradeDate;

      if (current.quantity === 0) {
        positionMap.delete(transaction.assetSymbol);
      } else {
        positionMap.set(transaction.assetSymbol, current);
      }
    }

    return positionMap;
  }

  private rebuildSnapshots(portfolioId: string): void {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      return;
    }

    const transactions = [...(this.portfolioTransactions.get(portfolioId) ?? [])].sort((left, right) => {
      return left.tradeDate.localeCompare(right.tradeDate) || left.createdAt.getTime() - right.createdAt.getTime();
    });

    const snapshots: PortfolioSnapshot[] = [
      {
        id: randomUUID(),
        portfolioId,
        asOfDate: portfolio.createdAt.toISOString().slice(0, 10),
        createdAt: portfolio.createdAt,
        positions: [],
        transactionCount: 0,
        totalCostBasis: 0
      }
    ];

    const tradeDates = Array.from(new Set(transactions.map((transaction) => transaction.tradeDate)));
    for (const tradeDate of tradeDates) {
      const positions = Array.from(this.buildPositionMap(portfolioId, tradeDate).values());
      snapshots.push({
        id: randomUUID(),
        portfolioId,
        asOfDate: tradeDate,
        createdAt: new Date(`${tradeDate}T23:59:59.000Z`),
        positions,
        transactionCount: transactions.filter((transaction) => transaction.tradeDate <= tradeDate).length,
        totalCostBasis: Number(
          positions.reduce((sum, position) => sum + position.totalCostBasis, 0).toFixed(2)
        )
      });
    }

    this.ledgerSnapshots.set(portfolioId, snapshots);
  }

  private pushEvent(
    topic: string,
    aggregateId: string,
    payload: Record<string, unknown>
  ): void {
    this.outboxEvents.push({
      id: randomUUID(),
      topic,
      aggregateId,
      payload,
      createdAt: new Date()
    });
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
      id: "usr_advisor",
      email: "advisor@example.com",
      name: "Advisor User",
      role: "user",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_assistant",
      email: "assistant@example.com",
      name: "Assistant User",
      role: "user",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_client",
      email: "client@example.com",
      name: "Client Viewer",
      role: "user",
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

  store.offices.set("ofc_main", {
    id: "ofc_main",
    name: "Orion Advisory",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  store.offices.set("ofc_private", {
    id: "ofc_private",
    name: "Private Allocation Desk",
    status: "active",
    createdAt: now,
    updatedAt: now
  });

  store.officeMembers.set("ofm_admin_main", {
    id: "ofm_admin_main",
    officeId: "ofc_main",
    userId: "usr_admin",
    role: "office_admin",
    createdAt: now
  });
  store.officeMembers.set("ofm_user_main", {
    id: "ofm_user_main",
    officeId: "ofc_main",
    userId: "usr_user",
    role: "office_admin",
    createdAt: now
  });
  store.officeMembers.set("ofm_advisor_main", {
    id: "ofm_advisor_main",
    officeId: "ofc_main",
    userId: "usr_advisor",
    role: "advisor",
    createdAt: now
  });
  store.officeMembers.set("ofm_analyst_main", {
    id: "ofm_analyst_main",
    officeId: "ofc_main",
    userId: "usr_analyst",
    role: "analyst",
    createdAt: now
  });
  store.officeMembers.set("ofm_assistant_main", {
    id: "ofm_assistant_main",
    officeId: "ofc_main",
    userId: "usr_assistant",
    role: "assistant",
    createdAt: now
  });
  store.officeMembers.set("ofm_client_main", {
    id: "ofm_client_main",
    officeId: "ofc_main",
    userId: "usr_client",
    role: "client",
    createdAt: now
  });
  store.officeMembers.set("ofm_analyst_private", {
    id: "ofm_analyst_private",
    officeId: "ofc_private",
    userId: "usr_analyst",
    role: "analyst",
    createdAt: now
  });
  store.officeMembers.set("ofm_other_private", {
    id: "ofm_other_private",
    officeId: "ofc_private",
    userId: "usr_other",
    role: "office_admin",
    createdAt: now
  });

  store.advisoryTeams.set("team_core_main", {
    id: "team_core_main",
    officeId: "ofc_main",
    name: "Core Advisory Team",
    description: "Advisor, analyst, and assistant coverage for priority clients.",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  for (const [id, userId] of [
    ["tm_advisor_main", "usr_advisor"],
    ["tm_analyst_main", "usr_analyst"],
    ["tm_assistant_main", "usr_assistant"]
  ]) {
    const membership = Array.from(store.officeMembers.values()).find(
      (entry) => entry.officeId === "ofc_main" && entry.userId === userId
    );
    if (membership) {
      store.advisoryTeamMembers.set(id, {
        id,
        officeId: "ofc_main",
        teamId: "team_core_main",
        userId,
        role: membership.role,
        createdAt: now
      });
    }
  }
  store.advisoryAssignments.set("asn_core_client_main", {
    id: "asn_core_client_main",
    officeId: "ofc_main",
    resourceType: "client",
    resourceId: "client_main",
    teamId: "team_core_main",
    permissions: ["client.read", "ledger.read", "analytics.read", "reports.request"],
    createdBy: "usr_user",
    createdAt: now
  });
  store.advisoryAssignments.set("asn_client_viewer_main", {
    id: "asn_client_viewer_main",
    officeId: "ofc_main",
    resourceType: "client",
    resourceId: "client_main",
    assigneeUserId: "usr_client",
    permissions: ["client.read", "reports.request", "notifications.read"],
    createdBy: "usr_user",
    createdAt: now
  });

  store.addAccount({
    id: "acct_main",
    officeId: "ofc_main",
    name: "Main Portfolio Account",
    ownerUserId: "usr_user",
    createdAt: now,
    updatedAt: now
  });
  store.addAccount({
    id: "acct_private",
    officeId: "ofc_private",
    name: "Private Account",
    ownerUserId: "usr_other",
    createdAt: now,
    updatedAt: now
  });
  store.addAccount({
    id: "acct_income",
    officeId: "ofc_private",
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
    officeId: "ofc_main",
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
    officeId: "ofc_private",
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

  store.addLedgerPortfolio(
    {
      id: "prt_main",
      officeId: "ofc_main",
      accountId: "acct_main",
      name: "Core Growth",
      description: "Long-term core allocation with ETFs and large-cap equities.",
      baseCurrency: "USD",
      createdAt: now,
      updatedAt: new Date("2026-07-12T00:00:00.000Z")
    },
    {
      status: "ready",
      freshness: "fresh",
      analyticsState: "ready",
      marketDataState: "ready",
      warnings: []
    },
    [
      {
        id: "pltxn_001",
        assetSymbol: "MSFT",
        assetName: "Microsoft",
        tradeDate: "2026-07-08",
        type: "buy",
        quantity: 120,
        unitPrice: 410,
        totalAmount: 49200,
        currency: "USD",
        notes: "Initial core position",
        createdAt: new Date("2026-07-08T10:00:00.000Z")
      },
      {
        id: "pltxn_002",
        assetSymbol: "VTI",
        assetName: "Vanguard Total Stock Market ETF",
        tradeDate: "2026-07-10",
        type: "buy",
        quantity: 300,
        unitPrice: 229.33,
        totalAmount: 68799,
        currency: "USD",
        notes: "Broad market allocation",
        createdAt: new Date("2026-07-10T10:00:00.000Z")
      },
      {
        id: "pltxn_003",
        assetSymbol: "NVDA",
        assetName: "NVIDIA",
        tradeDate: "2026-07-12",
        type: "buy",
        quantity: 55,
        unitPrice: 803.64,
        totalAmount: 44200.2,
        currency: "USD",
        notes: "AI growth sleeve",
        createdAt: new Date("2026-07-12T10:00:00.000Z")
      }
    ]
  );

  store.addLedgerPortfolio(
    {
      id: "prt_income",
      officeId: "ofc_private",
      accountId: "acct_income",
      name: "Income Sleeve",
      description: "Dividend and bond sleeve monitored by the analyst team.",
      baseCurrency: "USD",
      createdAt: now,
      updatedAt: new Date("2026-07-13T00:00:00.000Z")
    },
    {
      status: "degraded",
      freshness: "partial",
      analyticsState: "pending",
      marketDataState: "pending",
      warnings: [
        "Fixed-income market data is partially delayed.",
        "Analytics refresh is pending for the latest trade."
      ]
    },
    [
      {
        id: "pltxn_101",
        assetSymbol: "LQD",
        assetName: "iShares iBoxx $ Investment Grade Corporate Bond ETF",
        tradeDate: "2026-07-09",
        type: "buy",
        quantity: 410,
        unitPrice: 93.9,
        totalAmount: 38499,
        currency: "USD",
        notes: "Investment grade exposure",
        createdAt: new Date("2026-07-09T10:00:00.000Z")
      },
      {
        id: "pltxn_102",
        assetSymbol: "VNQ",
        assetName: "Vanguard Real Estate ETF",
        tradeDate: "2026-07-10",
        type: "buy",
        quantity: 160,
        unitPrice: 78.75,
        totalAmount: 12600,
        currency: "USD",
        notes: "REIT income sleeve",
        createdAt: new Date("2026-07-10T10:00:00.000Z")
      },
      {
        id: "pltxn_103",
        assetSymbol: "SCHD",
        assetName: "Schwab US Dividend Equity ETF",
        tradeDate: "2026-07-13",
        type: "buy",
        quantity: 290,
        unitPrice: 106.21,
        totalAmount: 30800.9,
        currency: "USD",
        notes: "Dividend coverage",
        createdAt: new Date("2026-07-13T10:00:00.000Z")
      }
    ]
  );

  return store;
}
