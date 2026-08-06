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
  ClientDetail,
  ClientProfile,
  ClientSummary,
  Household
} from "../../01-domain/clients/client";
import {
  AuditEvent,
  AuditExportJob,
  AuditResourceType,
  AuditSeverity,
  SafeAuditMetadata,
  SupervisionReview
} from "../../01-domain/compliance/audit";
import { ReportPackage } from "../../01-domain/delivery/report-package";
import { ReviewItem } from "../../01-domain/workbench/workbench";
import {
  Portfolio,
  PortfolioDetail,
  PortfolioOutboxEvent,
  PortfolioPosition,
  PortfolioSnapshot,
  PortfolioSummary,
  PortfolioTransaction
} from "../../01-domain/portfolios/portfolio";
import { Office, OfficeMembership, OfficeMembershipSummary } from "../../01-domain/offices/office";
import { User } from "../../01-domain/users/user";
import {
  AccountRepository,
  AppendAuditEventInput,
  AdvisoryTeamRepository,
  AuditEventFilters,
  AuditEventPage,
  AuditRepository,
  ClientFilters,
  ClientRepository,
  CreateAuditExportInput,
  CreateClientInput,
  CreateHouseholdInput,
  CreateReviewItemInput,
  CreateAdvisoryAssignmentInput,
  CreateAdvisoryTeamInput,
  CreatePortfolioInput,
  CreateImportedPortfolioInput,
  CreateReportPackageInput,
  CreatePortfolioTransactionInput,
  CreateRefreshTokenInput,
  CreateUserInput,
  OfficeRepository,
  PortfolioRepository,
  ReportPackageFilters,
  ReportPackageRepository,
  PortfolioTransactionIdempotencyRecord,
  RefreshTokenRecord,
  RefreshTokenRepository,
  RefreshTokenRevocationReason,
  SupervisionReviewFilters,
  UpdateAdvisoryTeamInput,
  UpdateClientInput,
  UpdateHouseholdInput,
  UpdateReviewItemInput,
  UpdateSupervisionReviewInput,
  UpdateReportPackageInput,
  UpdatePortfolioInput,
  UserRepository,
  WorkbenchRepository,
  ReviewItemFilters
} from "../../02-application/ports/repositories";
import { ApplicationError } from "../../02-application/errors/application-error";
import { ROLE_PERMISSION_MATRIX } from "../../02-application/auth/permission-service";
import { AnalyticsPortfolioProjection } from "../../modules/analytics/ports";
import { PortfolioMarketDataProjection } from "../../modules/market-data/ports";
import {
  classifyFreshness,
  MARKET_DATA_FRESHNESS_POLICY
} from "../../modules/market-data/freshness";

interface PortfolioRuntimeMeta {
  status: "ready" | "syncing" | "degraded";
  freshness: "fresh" | "partial" | "stale";
  analyticsState: "ready" | "pending";
  marketDataState: "ready" | "pending";
  warnings: string[];
  marketDataAsOf?: Date;
  analyticsAsOf?: Date;
}

export class InMemoryIdentityStore
  implements
    UserRepository,
    AccountRepository,
    OfficeRepository,
    AdvisoryTeamRepository,
    ClientRepository,
    WorkbenchRepository,
    AuditRepository,
    ReportPackageRepository,
    RefreshTokenRepository,
    PortfolioRepository,
    PortfolioMarketDataProjection,
    AnalyticsPortfolioProjection
{
  constructor(private readonly now: () => Date = () => new Date()) {}

  readonly users = new Map<string, User>();
  readonly offices = new Map<string, Office>();
  readonly officeMembers = new Map<string, OfficeMembership>();
  readonly advisoryTeams = new Map<string, AdvisoryTeam>();
  readonly advisoryTeamMembers = new Map<string, AdvisoryTeamMember>();
  readonly advisoryAssignments = new Map<string, AdvisoryAssignment>();
  readonly households = new Map<string, Household>();
  readonly clients = new Map<string, ClientProfile>();
  readonly reviewItems = new Map<string, ReviewItem>();
  readonly auditEvents = new Map<string, AuditEvent>();
  readonly supervisionReviews = new Map<string, SupervisionReview>();
  readonly auditExports = new Map<string, AuditExportJob>();
  readonly reportPackages = new Map<string, ReportPackage>();
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
    const normalizedEmail = email.toLowerCase();

    return Array.from(this.users.values()).find(
      (user) => user.email.toLowerCase() === normalizedEmail
    );
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

        return this.withAccountSnapshotFreshness({
          ...snapshot,
          membershipRole: membership.role,
          accountName: membership.accountName
        });
      })
      .filter((snapshot): snapshot is PortfolioAccountSnapshot => Boolean(snapshot));
  }

  async findPortfolioSnapshotByAccountId(
    accountId: string
  ): Promise<PortfolioAccountSnapshot | undefined> {
    const snapshot = this.portfolioSnapshots.get(accountId);
    return snapshot ? this.withAccountSnapshotFreshness(snapshot) : undefined;
  }

  async listOfficesForUser(userId: string, isAdmin: boolean): Promise<OfficeMembershipSummary[]> {
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

  async listOfficeMembers(officeId: string): Promise<
    Array<
      OfficeMembership & {
        userName: string;
        userEmail: string;
      }
    >
  > {
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

  async listClients(
    officeId: string,
    filters: ClientFilters,
    visibleClientIds?: Set<string>
  ): Promise<ClientSummary[]> {
    const search = filters.search?.trim().toLowerCase();
    return Array.from(this.clients.values())
      .filter((client) => client.officeId === officeId)
      .filter((client) => !visibleClientIds || visibleClientIds.has(client.id))
      .filter((client) => !filters.status || client.status === filters.status)
      .filter(
        (client) =>
          !filters.onboardingStatus || client.onboardingStatus === filters.onboardingStatus
      )
      .filter((client) => !filters.advisorUserId || client.advisorUserId === filters.advisorUserId)
      .filter((client) => !filters.householdId || client.householdId === filters.householdId)
      .filter((client) => {
        if (!search) {
          return true;
        }
        return [client.name, client.email, client.documentLabel ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(search);
      })
      .map((client) => this.toClientSummary(client))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async findClientById(clientId: string): Promise<ClientDetail | undefined> {
    const client = this.clients.get(clientId);
    return client ? this.toClientDetail(client) : undefined;
  }

  async createClient(input: CreateClientInput): Promise<ClientDetail> {
    const client: ClientProfile = { ...input };
    this.clients.set(client.id, client);
    this.pushEvent("ClientCreated", client.id, {
      officeId: client.officeId,
      clientId: client.id,
      actorId: input.advisorUserId
    });
    return this.toClientDetail(client);
  }

  async updateClient(
    clientId: string,
    input: UpdateClientInput
  ): Promise<ClientDetail | undefined> {
    const client = this.clients.get(clientId);
    if (!client) {
      return undefined;
    }

    if (input.householdId !== undefined) {
      client.householdId = input.householdId;
    }
    if (input.name !== undefined) {
      client.name = input.name;
    }
    if (input.email !== undefined) {
      client.email = input.email;
    }
    if (input.phone !== undefined) {
      client.phone = input.phone;
    }
    if (input.documentLabel !== undefined) {
      client.documentLabel = input.documentLabel;
    }
    if (input.status !== undefined) {
      client.status = input.status;
    }
    if (input.onboardingStatus !== undefined) {
      client.onboardingStatus = input.onboardingStatus;
    }
    if (input.advisorUserId !== undefined) {
      client.advisorUserId = input.advisorUserId;
    }
    if (input.riskProfileDescriptor !== undefined) {
      client.riskProfileDescriptor = input.riskProfileDescriptor;
    }
    if (input.notes !== undefined) {
      client.notes = input.notes;
    }
    client.updatedAt = input.updatedAt;
    if (input.archivedAt) {
      client.archivedAt = input.archivedAt;
    }
    this.pushEvent(input.status === "archived" ? "ClientArchived" : "ClientUpdated", client.id, {
      officeId: client.officeId,
      clientId: client.id
    });
    return this.toClientDetail(client);
  }

  async listHouseholds(officeId: string): Promise<Household[]> {
    return Array.from(this.households.values())
      .filter((household) => household.officeId === officeId)
      .map((household) => ({ ...household }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async findHouseholdById(householdId: string): Promise<Household | undefined> {
    const household = this.households.get(householdId);
    return household ? { ...household } : undefined;
  }

  async createHousehold(input: CreateHouseholdInput): Promise<Household> {
    const household: Household = { ...input };
    this.households.set(household.id, household);
    this.pushEvent("HouseholdCreated", household.id, {
      officeId: household.officeId,
      householdId: household.id
    });
    return { ...household };
  }

  async updateHousehold(
    householdId: string,
    input: UpdateHouseholdInput
  ): Promise<Household | undefined> {
    const household = this.households.get(householdId);
    if (!household) {
      return undefined;
    }

    if (input.name !== undefined) {
      household.name = input.name;
    }
    if (input.status !== undefined) {
      household.status = input.status;
    }
    household.updatedAt = input.updatedAt;
    this.pushEvent("HouseholdUpdated", household.id, {
      officeId: household.officeId,
      householdId: household.id
    });
    return { ...household };
  }

  async listReviewItems(
    officeId: string,
    filters: ReviewItemFilters,
    visibleClientIds?: Set<string>
  ): Promise<ReviewItem[]> {
    return Array.from(this.reviewItems.values())
      .filter((item) => item.officeId === officeId)
      .filter(
        (item) => !visibleClientIds || (item.clientId ? visibleClientIds.has(item.clientId) : false)
      )
      .filter((item) => !filters.status || item.status === filters.status)
      .filter((item) => !filters.severity || item.severity === filters.severity)
      .filter(
        (item) => !filters.assignedToUserId || item.assignedToUserId === filters.assignedToUserId
      )
      .filter((item) => !filters.clientId || item.clientId === filters.clientId)
      .map((item) => ({ ...item }))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  async findReviewItemById(reviewItemId: string): Promise<ReviewItem | undefined> {
    const item = this.reviewItems.get(reviewItemId);
    return item ? { ...item } : undefined;
  }

  async createReviewItem(input: CreateReviewItemInput): Promise<ReviewItem> {
    const item: ReviewItem = { ...input };
    this.reviewItems.set(item.id, item);
    this.pushEvent("ReviewItemCreated", item.id, {
      officeId: item.officeId,
      reviewItemId: item.id,
      resourceType: item.resourceType,
      severity: item.severity
    });
    return { ...item };
  }

  async updateReviewItem(
    reviewItemId: string,
    input: UpdateReviewItemInput
  ): Promise<ReviewItem | undefined> {
    const item = this.reviewItems.get(reviewItemId);
    if (!item) {
      return undefined;
    }

    if (input.title !== undefined) {
      item.title = input.title;
    }
    if (input.severity !== undefined) {
      item.severity = input.severity;
    }
    if (input.status !== undefined) {
      item.status = input.status;
    }
    if (input.assignedToUserId !== undefined) {
      item.assignedToUserId = input.assignedToUserId;
    }
    if (input.dueDate !== undefined) {
      item.dueDate = input.dueDate;
    }
    if (input.notes !== undefined) {
      item.notes = input.notes;
    }
    item.updatedAt = input.updatedAt;
    if (input.closedAt) {
      item.closedAt = input.closedAt;
    }
    this.pushEvent("ReviewItemUpdated", item.id, {
      officeId: item.officeId,
      reviewItemId: item.id,
      status: item.status,
      severity: item.severity
    });
    return { ...item };
  }

  async listAuditEvents(officeId: string, filters: AuditEventFilters): Promise<AuditEventPage> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(Math.max(1, filters.pageSize ?? 25), 100);
    const fromTime = filters.from ? new Date(filters.from).getTime() : undefined;
    const toTime = filters.to ? new Date(filters.to).getTime() : undefined;
    const action = filters.action?.trim().toLowerCase();
    const filtered = Array.from(this.auditEvents.values())
      .filter((event) => event.officeId === officeId)
      .filter((event) => !filters.actorId || event.actorId === filters.actorId)
      .filter((event) => !action || event.action.toLowerCase().includes(action))
      .filter((event) => !filters.outcome || event.outcome === filters.outcome)
      .filter((event) => !filters.severity || event.severity === filters.severity)
      .filter((event) => !filters.resourceType || event.resourceType === filters.resourceType)
      .filter((event) => !filters.resourceId || event.resourceId === filters.resourceId)
      .filter((event) => !filters.clientId || event.clientId === filters.clientId)
      .filter((event) => !filters.portfolioId || event.portfolioId === filters.portfolioId)
      .filter((event) => fromTime === undefined || event.createdAt.getTime() >= fromTime)
      .filter((event) => toTime === undefined || event.createdAt.getTime() <= toTime)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const start = (page - 1) * pageSize;

    return {
      events: filtered.slice(start, start + pageSize).map((event) => this.copyAuditEvent(event)),
      total: filtered.length,
      page,
      pageSize
    };
  }

  async findAuditEventById(auditEventId: string): Promise<AuditEvent | undefined> {
    const event = this.auditEvents.get(auditEventId);
    return event ? this.copyAuditEvent(event) : undefined;
  }

  async appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEvent> {
    return this.appendStoredAuditEvent(input);
  }

  async listSupervisionReviews(
    officeId: string,
    filters: SupervisionReviewFilters
  ): Promise<SupervisionReview[]> {
    return Array.from(this.supervisionReviews.values())
      .filter((review) => review.officeId === officeId)
      .filter((review) => !filters.status || review.status === filters.status)
      .filter((review) => !filters.severity || review.severity === filters.severity)
      .filter(
        (review) =>
          !filters.assignedToUserId || review.assignedToUserId === filters.assignedToUserId
      )
      .map((review) => ({ ...review }))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  async findSupervisionReviewById(reviewId: string): Promise<SupervisionReview | undefined> {
    const review = this.supervisionReviews.get(reviewId);
    return review ? { ...review } : undefined;
  }

  async updateSupervisionReview(
    reviewId: string,
    input: UpdateSupervisionReviewInput
  ): Promise<SupervisionReview | undefined> {
    const review = this.supervisionReviews.get(reviewId);
    if (!review) {
      return undefined;
    }

    if (input.status !== undefined) {
      review.status = input.status;
    }
    if (input.assignedToUserId !== undefined) {
      review.assignedToUserId = input.assignedToUserId || undefined;
      if (review.assignedToUserId && review.status === "open") {
        review.status = "assigned";
      }
    }
    if (input.resolutionComment !== undefined) {
      review.resolutionComment = input.resolutionComment;
    }
    review.updatedAt = input.updatedAt;
    if (input.resolvedAt) {
      review.resolvedAt = input.resolvedAt;
    }
    return { ...review };
  }

  async createAuditExport(input: CreateAuditExportInput): Promise<AuditExportJob> {
    const completedAt = new Date(input.createdAt.getTime() + 1000);
    const exportJob: AuditExportJob = {
      id: input.id,
      officeId: input.officeId,
      requestedBy: input.requestedBy,
      format: input.format,
      status: "completed",
      eventCount: input.eventCount,
      filters: { ...input.filters },
      downloadUrl: `/api/v1/offices/${input.officeId}/audit-exports/${input.id}.${input.format}`,
      createdAt: input.createdAt,
      completedAt
    };
    this.auditExports.set(exportJob.id, exportJob);
    return { ...exportJob, filters: { ...exportJob.filters } };
  }

  async listReportPackagesByClient(
    clientId: string,
    filters: ReportPackageFilters = {}
  ): Promise<ReportPackage[]> {
    return Array.from(this.reportPackages.values())
      .filter((reportPackage) => reportPackage.clientId === clientId)
      .filter((reportPackage) => !filters.status || reportPackage.status === filters.status)
      .map((reportPackage) => this.copyReportPackage(reportPackage))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  async findReportPackageById(packageId: string): Promise<ReportPackage | undefined> {
    const reportPackage = this.reportPackages.get(packageId);
    return reportPackage ? this.copyReportPackage(reportPackage) : undefined;
  }

  async createReportPackage(input: CreateReportPackageInput): Promise<ReportPackage> {
    const reportPackage: ReportPackage = {
      ...input,
      items: input.items.map((item) => ({ ...item }))
    };
    this.reportPackages.set(reportPackage.id, reportPackage);
    return this.copyReportPackage(reportPackage);
  }

  async updateReportPackage(
    packageId: string,
    input: UpdateReportPackageInput
  ): Promise<ReportPackage | undefined> {
    const reportPackage = this.reportPackages.get(packageId);
    if (!reportPackage) {
      return undefined;
    }

    if (input.title !== undefined) {
      reportPackage.title = input.title;
    }
    if (input.summaryNotes !== undefined) {
      reportPackage.summaryNotes = input.summaryNotes;
    }
    if (input.internalNotes !== undefined) {
      reportPackage.internalNotes = input.internalNotes;
    }
    if (input.status !== undefined) {
      reportPackage.status = input.status;
    }
    if (input.items !== undefined) {
      reportPackage.items = input.items.map((item) => ({ ...item }));
    }
    if (input.approvedBy !== undefined) {
      reportPackage.approvedBy = input.approvedBy;
    }
    if (input.deliveredBy !== undefined) {
      reportPackage.deliveredBy = input.deliveredBy;
    }
    if (input.viewedBy !== undefined) {
      reportPackage.viewedBy = input.viewedBy;
    }
    if (input.revokedBy !== undefined) {
      reportPackage.revokedBy = input.revokedBy;
    }
    reportPackage.updatedAt = input.updatedAt;
    if (input.approvedAt) {
      reportPackage.approvedAt = input.approvedAt;
    }
    if (input.deliveredAt) {
      reportPackage.deliveredAt = input.deliveredAt;
    }
    if (input.viewedAt) {
      reportPackage.viewedAt = input.viewedAt;
    }
    if (input.revokedAt) {
      reportPackage.revokedAt = input.revokedAt;
    }
    return this.copyReportPackage(reportPackage);
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

  async createImportedPortfolio(input: CreateImportedPortfolioInput): Promise<Portfolio> {
    if (this.portfolios.has(input.portfolio.id)) {
      return this.portfolios.get(input.portfolio.id)!;
    }

    const idempotencyKeys = new Set<string>();
    const positions = new Map<string, number>();
    const orderedTransactions = [...input.transactions].sort(
      (left, right) =>
        left.tradeDate.localeCompare(right.tradeDate) ||
        (left.sourceRowNumber ?? 0) - (right.sourceRowNumber ?? 0)
    );

    for (const transaction of orderedTransactions) {
      if (transaction.idempotencyKey) {
        if (idempotencyKeys.has(transaction.idempotencyKey)) {
          throw new ApplicationError(
            "conflict",
            "portfolio_import.duplicate_row_idempotency",
            "Imported transaction row was duplicated"
          );
        }
        idempotencyKeys.add(transaction.idempotencyKey);
      }

      const current = positions.get(transaction.assetSymbol) ?? 0;
      const next =
        transaction.type === "buy"
          ? current + transaction.quantity
          : current - transaction.quantity;
      if (next < 0) {
        throw new ApplicationError(
          "invalid",
          "portfolio.negative_position",
          "Sell transaction would create a negative position"
        );
      }
      positions.set(transaction.assetSymbol, next);
    }

    const portfolio: Portfolio = { ...input.portfolio };
    const transactions = orderedTransactions.map((transaction) => ({ ...transaction }));

    this.portfolios.set(portfolio.id, portfolio);
    this.portfolioTransactions.set(portfolio.id, transactions);
    this.portfolioRuntimeMeta.set(portfolio.id, {
      status: "syncing",
      freshness: "partial",
      analyticsState: "pending",
      marketDataState: "pending",
      warnings: [
        "Analytics recomputation pending after spreadsheet import.",
        "Market data refresh pending for imported assets."
      ]
    });
    for (const transaction of transactions) {
      if (transaction.idempotencyKey) {
        this.transactionIdempotency.set(
          this.getIdempotencyIndex(portfolio.id, transaction.idempotencyKey),
          {
            transaction,
            requestFingerprint: transaction.idempotencyFingerprint ?? ""
          }
        );
      }
    }
    this.rebuildSnapshots(portfolio.id);

    this.pushEvent("PortfolioCreated", portfolio.id, {
      officeId: portfolio.officeId,
      portfolioId: portfolio.id,
      accountId: portfolio.accountId,
      importId: input.importId
    });
    this.pushEvent("PortfolioTransactionsImported", portfolio.id, {
      officeId: portfolio.officeId,
      portfolioId: portfolio.id,
      importId: input.importId,
      transactionCount: transactions.length,
      distinctAssetCount: new Set(transactions.map((transaction) => transaction.assetSymbol)).size
    });
    this.pushEvent("PositionProjectionUpdated", portfolio.id, {
      officeId: portfolio.officeId,
      portfolioId: portfolio.id,
      importId: input.importId
    });
    this.pushEvent("PortfolioSnapshotCreated", portfolio.id, {
      officeId: portfolio.officeId,
      portfolioId: portfolio.id,
      importId: input.importId
    });
    this.pushEvent("AnalyticsRequested", portfolio.id, {
      officeId: portfolio.officeId,
      portfolioId: portfolio.id,
      importId: input.importId
    });
    for (const assetSymbol of new Set(transactions.map((transaction) => transaction.assetSymbol))) {
      this.pushEvent("MarketDataRequested", assetSymbol, {
        officeId: portfolio.officeId,
        portfolioId: portfolio.id,
        importId: input.importId,
        assetSymbol
      });
    }

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
      return (
        right.tradeDate.localeCompare(left.tradeDate) ||
        right.createdAt.getTime() - left.createdAt.getTime()
      );
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

  async markMarketDataRefreshSucceeded(symbol: string, refreshedAt: Date): Promise<void> {
    for (const portfolioId of await this.listPortfolioIdsHoldingAsset(symbol)) {
      const meta = this.portfolioRuntimeMeta.get(portfolioId);
      if (!meta) {
        continue;
      }

      meta.marketDataState = "ready";
      meta.marketDataAsOf = refreshedAt;
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

  async markAnalyticsSucceeded(portfolioId: string, refreshedAt: Date): Promise<void> {
    const meta = this.portfolioRuntimeMeta.get(portfolioId);
    if (!meta) {
      return;
    }

    meta.analyticsState = "ready";
    meta.analyticsAsOf = refreshedAt;
    meta.status = meta.marketDataState === "pending" ? "syncing" : "ready";
    meta.freshness = meta.marketDataState === "pending" ? "partial" : "fresh";
    meta.warnings = meta.warnings.filter((warning) => !warning.toLowerCase().includes("analytics"));
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
    return Array.from(this.refreshTokens.values()).find((token) => token.tokenHash === tokenHash);
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

  async revoke(id: string, revokedAt: Date, reason: RefreshTokenRevocationReason): Promise<void> {
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

  private toClientSummary(client: ClientProfile): ClientSummary {
    const household = client.householdId ? this.households.get(client.householdId) : undefined;
    const advisor = client.advisorUserId ? this.users.get(client.advisorUserId) : undefined;
    const accounts = Array.from(this.accounts.values()).filter(
      (account) => account.clientId === client.id
    );
    const portfolioCount = Array.from(this.portfolios.values()).filter(
      (portfolio) => portfolio.clientId === client.id
    ).length;

    return {
      ...client,
      householdName: household?.name,
      advisorName: advisor?.name,
      accountCount: accounts.length,
      portfolioCount
    };
  }

  private toClientDetail(client: ClientProfile): ClientDetail {
    const summary = this.toClientSummary(client);
    const accounts = Array.from(this.accounts.values())
      .filter((account) => account.clientId === client.id)
      .map((account) => ({
        id: account.id,
        officeId: account.officeId,
        name: account.name,
        portfolioCount: Array.from(this.portfolios.values()).filter(
          (portfolio) => portfolio.accountId === account.id
        ).length
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const portfolios = Array.from(this.portfolios.values())
      .filter((portfolio) => portfolio.clientId === client.id)
      .map((portfolio) => this.toPortfolioSummary(portfolio, client.advisorUserId ?? "", false))
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      ...summary,
      household: client.householdId ? this.households.get(client.householdId) : undefined,
      accounts,
      portfolios
    };
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

  private replaceTeamMembers(team: AdvisoryTeam, memberUserIds: string[], createdAt: Date): void {
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
    const clientId = portfolio.clientId ?? account?.clientId;
    const householdId = portfolio.householdId ?? account?.householdId;
    const client = clientId ? this.clients.get(clientId) : undefined;
    const household = householdId ? this.households.get(householdId) : undefined;
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
      clientId,
      clientName: client?.name,
      householdId,
      householdName: household?.name,
      name: portfolio.name,
      description: portfolio.description,
      baseCurrency: portfolio.baseCurrency,
      membershipRole:
        membership?.role ??
        (isAdmin ? "owner" : account?.ownerUserId === userId ? "owner" : "viewer"),
      holdingsCount: positions.length,
      transactionCount: transactions.length,
      totalCostBasis,
      freshness: this.resolvePortfolioFreshness(meta),
      status: meta.status,
      analyticsState: meta.analyticsState,
      marketDataState: meta.marketDataState,
      lastTransactionDate: transactions[0]?.tradeDate
    };
  }

  private resolvePortfolioFreshness(meta: PortfolioRuntimeMeta): PortfolioRuntimeMeta["freshness"] {
    if (meta.marketDataState === "pending" || meta.analyticsState === "pending") {
      return meta.freshness;
    }

    const states = [
      meta.marketDataAsOf
        ? classifyFreshness(meta.marketDataAsOf, this.now(), MARKET_DATA_FRESHNESS_POLICY.quote)
        : meta.freshness,
      meta.analyticsAsOf
        ? classifyFreshness(meta.analyticsAsOf, this.now(), MARKET_DATA_FRESHNESS_POLICY.analytics)
        : meta.freshness
    ];

    return states.includes("stale") ? "stale" : states.includes("partial") ? "partial" : "fresh";
  }

  private withAccountSnapshotFreshness(
    snapshot: PortfolioAccountSnapshot
  ): PortfolioAccountSnapshot {
    const asOf = new Date(snapshot.meta.asOf);
    if (Number.isNaN(asOf.getTime())) {
      return snapshot;
    }

    const freshness = classifyFreshness(asOf, this.now(), MARKET_DATA_FRESHNESS_POLICY.analytics);
    if (freshness === snapshot.meta.freshness) {
      return snapshot;
    }

    return {
      ...snapshot,
      meta: {
        ...snapshot.meta,
        freshness,
        status: freshness === "stale" ? "degraded" : "syncing",
        warnings: [
          ...snapshot.meta.warnings,
          `Os dados têm como referência ${snapshot.meta.asOf} e excederam o limite de atualização.`
        ]
      }
    };
  }

  private getIdempotencyIndex(portfolioId: string, key: string): string {
    return `${portfolioId}:${key}`;
  }

  private buildPositionMap(portfolioId: string, asOfDate?: string): Map<string, PortfolioPosition> {
    const positionMap = new Map<string, PortfolioPosition>();
    const transactions = [...(this.portfolioTransactions.get(portfolioId) ?? [])]
      .filter((transaction) => !asOfDate || transaction.tradeDate <= asOfDate)
      .sort((left, right) => {
        return (
          left.tradeDate.localeCompare(right.tradeDate) ||
          left.createdAt.getTime() - right.createdAt.getTime()
        );
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

    const transactions = [...(this.portfolioTransactions.get(portfolioId) ?? [])].sort(
      (left, right) => {
        return (
          left.tradeDate.localeCompare(right.tradeDate) ||
          left.createdAt.getTime() - right.createdAt.getTime()
        );
      }
    );

    const snapshots: PortfolioSnapshot[] = [];
    const wasCreatedBySpreadsheetImport = transactions.some(
      (transaction) => transaction.source === "spreadsheet_import"
    );
    if (!wasCreatedBySpreadsheetImport) {
      snapshots.push({
        id: randomUUID(),
        portfolioId,
        asOfDate: portfolio.createdAt.toISOString().slice(0, 10),
        createdAt: portfolio.createdAt,
        positions: [],
        transactionCount: 0,
        totalCostBasis: 0
      });
    }

    const tradeDates = Array.from(
      new Set(transactions.map((transaction) => transaction.tradeDate))
    );
    for (const tradeDate of tradeDates) {
      const positions = Array.from(this.buildPositionMap(portfolioId, tradeDate).values());
      snapshots.push({
        id: randomUUID(),
        portfolioId,
        asOfDate: tradeDate,
        createdAt: new Date(`${tradeDate}T23:59:59.000Z`),
        positions,
        transactionCount: transactions.filter((transaction) => transaction.tradeDate <= tradeDate)
          .length,
        totalCostBasis: Number(
          positions.reduce((sum, position) => sum + position.totalCostBasis, 0).toFixed(2)
        )
      });
    }

    this.ledgerSnapshots.set(portfolioId, snapshots);
  }

  private appendStoredAuditEvent(input: AppendAuditEventInput): AuditEvent {
    const event: AuditEvent = {
      ...input,
      metadata: { ...input.metadata }
    };
    this.auditEvents.set(event.id, event);

    if (event.reviewRequired) {
      const alreadyQueued = Array.from(this.supervisionReviews.values()).some(
        (review) => review.auditEventId === event.id
      );
      if (!alreadyQueued) {
        this.supervisionReviews.set(`sv_${event.id}`, {
          id: `sv_${event.id}`,
          officeId: event.officeId,
          auditEventId: event.id,
          status: "open",
          severity: event.severity,
          createdAt: event.createdAt,
          updatedAt: event.createdAt
        });
      }
    }

    return this.copyAuditEvent(event);
  }

  private copyAuditEvent(event: AuditEvent): AuditEvent {
    return {
      ...event,
      metadata: { ...event.metadata }
    };
  }

  private copyReportPackage(reportPackage: ReportPackage): ReportPackage {
    return {
      ...reportPackage,
      items: reportPackage.items.map((item) => ({ ...item }))
    };
  }

  private pushEvent(topic: string, aggregateId: string, payload: Record<string, unknown>): void {
    const createdAt = new Date();
    this.outboxEvents.push({
      id: randomUUID(),
      topic,
      aggregateId,
      payload,
      createdAt
    });
    this.appendAuditEventForOutbox(topic, aggregateId, payload, createdAt);
  }

  private appendAuditEventForOutbox(
    topic: string,
    aggregateId: string,
    payload: Record<string, unknown>,
    createdAt: Date
  ): void {
    const officeId = typeof payload.officeId === "string" ? payload.officeId : undefined;
    if (!officeId) {
      return;
    }

    this.appendStoredAuditEvent({
      id: randomUUID(),
      officeId,
      actorId: typeof payload.actorId === "string" ? payload.actorId : undefined,
      action: auditActionForTopic(topic),
      resourceType: auditResourceTypeForTopic(topic),
      resourceId: aggregateId,
      clientId: typeof payload.clientId === "string" ? payload.clientId : undefined,
      portfolioId: typeof payload.portfolioId === "string" ? payload.portfolioId : undefined,
      outcome: "success",
      severity: auditSeverityForTopic(topic),
      reviewRequired: auditReviewRequiredForTopic(topic),
      metadata: safeAuditMetadataFromPayload({ ...payload, topic }),
      createdAt
    });
  }
}

function auditActionForTopic(topic: string): string {
  const actions: Record<string, string> = {
    AdvisoryTeamCreated: "permission.team.created",
    AdvisoryTeamUpdated: "permission.team.updated",
    AdvisoryAssignmentCreated: "permission.assignment.created",
    AdvisoryAssignmentRevoked: "permission.assignment.revoked",
    ClientCreated: "client.created",
    ClientUpdated: "client.updated",
    ClientArchived: "client.archived",
    HouseholdCreated: "household.created",
    HouseholdUpdated: "household.updated",
    ReviewItemCreated: "review.item.created",
    ReviewItemUpdated: "review.item.updated",
    PortfolioCreated: "portfolio.created",
    PortfolioUpdated: "portfolio.updated",
    TransactionRecorded: "ledger.transaction.recorded",
    PositionProjectionUpdated: "ledger.position_projection.updated",
    PortfolioSnapshotCreated: "ledger.snapshot.created",
    AnalyticsRequested: "analytics.recompute.requested",
    MarketDataRequested: "market_data.refresh.requested"
  };
  return actions[topic] ?? `domain.${topic}`;
}

function auditResourceTypeForTopic(topic: string): AuditResourceType {
  if (topic.startsWith("Advisory")) {
    return "permission";
  }
  if (topic.startsWith("Client")) {
    return "client";
  }
  if (topic.startsWith("Household")) {
    return "household";
  }
  if (topic.startsWith("ReviewItem")) {
    return "review";
  }
  if (topic.startsWith("Portfolio") && !topic.includes("Snapshot")) {
    return "portfolio";
  }
  if (
    topic.startsWith("Transaction") ||
    topic.includes("Snapshot") ||
    topic.includes("Projection")
  ) {
    return "ledger";
  }
  if (topic.startsWith("Analytics")) {
    return "analytics";
  }
  if (topic.startsWith("MarketData")) {
    return "market_data";
  }
  return "office";
}

function auditSeverityForTopic(topic: string): AuditSeverity {
  if (topic.includes("Revoked") || topic.includes("Archived")) {
    return "warning";
  }
  if (topic === "AnalyticsRequested" || topic === "MarketDataRequested") {
    return "warning";
  }
  return "info";
}

function auditReviewRequiredForTopic(topic: string): boolean {
  return [
    "AdvisoryAssignmentCreated",
    "AdvisoryAssignmentRevoked",
    "AnalyticsRequested",
    "MarketDataRequested"
  ].includes(topic);
}

function safeAuditMetadataFromPayload(payload: Record<string, unknown>): SafeAuditMetadata {
  const metadata: SafeAuditMetadata = {};
  const blockedPattern = /(token|secret|password|credential|accountNumber|document|email|phone)/i;

  for (const [key, value] of Object.entries(payload)) {
    if (blockedPattern.test(key) || value === undefined) {
      continue;
    }
    if (typeof value === "string") {
      metadata[key] = value.length > 160 ? `${value.slice(0, 157)}...` : value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      metadata[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      metadata[key] = value;
    }
  }

  return metadata;
}
