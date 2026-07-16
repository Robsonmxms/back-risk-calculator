import {
  Account,
  AccountMember,
  AccountMembershipSummary,
  PortfolioAccountSnapshot
} from "../../01-domain/accounts/account";
import {
  AdvisoryAssignment,
  AdvisoryTeam,
  AdvisoryTeamSummary,
  AssignmentResourceType,
  PermissionKey
} from "../../01-domain/advisory/advisory-team";
import {
  ClientDetail,
  ClientOnboardingStatus,
  ClientStatus,
  ClientSummary,
  Household,
  HouseholdStatus
} from "../../01-domain/clients/client";
import {
  AuditEvent,
  AuditExportFormat,
  AuditExportJob,
  AuditOutcome,
  AuditResourceType,
  AuditSeverity,
  SafeAuditMetadata,
  SupervisionReview,
  SupervisionReviewStatus
} from "../../01-domain/compliance/audit";
import {
  ReviewItem,
  ReviewItemSeverity,
  ReviewItemStatus,
  ReviewResourceType
} from "../../01-domain/workbench/workbench";
import { User, UserRole } from "../../01-domain/users/user";
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
  listPortfolioSnapshotsForUser(userId: string): Promise<PortfolioAccountSnapshot[]>;
  findPortfolioSnapshotByAccountId(accountId: string): Promise<PortfolioAccountSnapshot | undefined>;
}

export interface OfficeRepository {
  listOfficesForUser(userId: string, isAdmin: boolean): Promise<OfficeMembershipSummary[]>;
  findOfficeById(officeId: string): Promise<Office | undefined>;
  findOfficeMembership(
    officeId: string,
    userId: string
  ): Promise<OfficeMembership | undefined>;
  listOfficeMembers(officeId: string): Promise<Array<OfficeMembership & {
    userName: string;
    userEmail: string;
  }>>;
  updateOffice(
    officeId: string,
    input: Partial<Pick<Office, "name" | "status" | "updatedAt">>
  ): Promise<Office | undefined>;
}

export interface CreateAdvisoryTeamInput {
  id: string;
  officeId: string;
  name: string;
  description?: string;
  memberUserIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateAdvisoryTeamInput {
  name?: string;
  description?: string;
  status?: AdvisoryTeam["status"];
  memberUserIds?: string[];
  updatedAt: Date;
}

export interface CreateAdvisoryAssignmentInput {
  id: string;
  officeId: string;
  resourceType: AssignmentResourceType;
  resourceId: string;
  assigneeUserId?: string;
  teamId?: string;
  permissions: PermissionKey[];
  createdBy: string;
  createdAt: Date;
}

export interface AdvisoryTeamRepository {
  listTeamsByOffice(officeId: string): Promise<AdvisoryTeamSummary[]>;
  findTeamById(teamId: string): Promise<AdvisoryTeam | undefined>;
  createTeam(input: CreateAdvisoryTeamInput): Promise<AdvisoryTeamSummary>;
  updateTeam(
    teamId: string,
    input: UpdateAdvisoryTeamInput
  ): Promise<AdvisoryTeamSummary | undefined>;
  listAssignmentsByOffice(officeId: string): Promise<AdvisoryAssignment[]>;
  listAssignmentsForUser(userId: string, officeId: string): Promise<AdvisoryAssignment[]>;
  listAssignmentsForResource(
    resourceType: AssignmentResourceType,
    resourceId: string
  ): Promise<AdvisoryAssignment[]>;
  findAssignmentById(assignmentId: string): Promise<AdvisoryAssignment | undefined>;
  createAssignment(input: CreateAdvisoryAssignmentInput): Promise<AdvisoryAssignment>;
  revokeAssignment(assignmentId: string, revokedAt: Date): Promise<AdvisoryAssignment | undefined>;
}

export interface ClientFilters {
  search?: string;
  status?: ClientStatus;
  advisorUserId?: string;
  householdId?: string;
  onboardingStatus?: ClientOnboardingStatus;
}

export interface CreateClientInput {
  id: string;
  officeId: string;
  householdId?: string;
  name: string;
  email: string;
  phone?: string;
  documentLabel?: string;
  status: ClientStatus;
  onboardingStatus: ClientOnboardingStatus;
  advisorUserId?: string;
  riskProfileDescriptor: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateClientInput {
  householdId?: string;
  name?: string;
  email?: string;
  phone?: string;
  documentLabel?: string;
  status?: ClientStatus;
  onboardingStatus?: ClientOnboardingStatus;
  advisorUserId?: string;
  riskProfileDescriptor?: string;
  notes?: string;
  updatedAt: Date;
  archivedAt?: Date;
}

export interface CreateHouseholdInput {
  id: string;
  officeId: string;
  name: string;
  status: HouseholdStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateHouseholdInput {
  name?: string;
  status?: HouseholdStatus;
  updatedAt: Date;
}

export interface ClientRepository {
  listClients(
    officeId: string,
    filters: ClientFilters,
    visibleClientIds?: Set<string>
  ): Promise<ClientSummary[]>;
  findClientById(clientId: string): Promise<ClientDetail | undefined>;
  createClient(input: CreateClientInput): Promise<ClientDetail>;
  updateClient(clientId: string, input: UpdateClientInput): Promise<ClientDetail | undefined>;
  listHouseholds(officeId: string): Promise<Household[]>;
  findHouseholdById(householdId: string): Promise<Household | undefined>;
  createHousehold(input: CreateHouseholdInput): Promise<Household>;
  updateHousehold(
    householdId: string,
    input: UpdateHouseholdInput
  ): Promise<Household | undefined>;
}

export interface ReviewItemFilters {
  status?: ReviewItemStatus;
  severity?: ReviewItemSeverity;
  assignedToUserId?: string;
  clientId?: string;
}

export interface CreateReviewItemInput {
  id: string;
  officeId: string;
  title: string;
  severity: ReviewItemSeverity;
  status: ReviewItemStatus;
  resourceType: ReviewResourceType;
  resourceId: string;
  clientId?: string;
  portfolioId?: string;
  assignedToUserId?: string;
  dueDate?: string;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateReviewItemInput {
  title?: string;
  severity?: ReviewItemSeverity;
  status?: ReviewItemStatus;
  assignedToUserId?: string;
  dueDate?: string;
  notes?: string;
  updatedAt: Date;
  closedAt?: Date;
}

export interface WorkbenchRepository {
  listReviewItems(
    officeId: string,
    filters: ReviewItemFilters,
    visibleClientIds?: Set<string>
  ): Promise<ReviewItem[]>;
  findReviewItemById(reviewItemId: string): Promise<ReviewItem | undefined>;
  createReviewItem(input: CreateReviewItemInput): Promise<ReviewItem>;
  updateReviewItem(
    reviewItemId: string,
    input: UpdateReviewItemInput
  ): Promise<ReviewItem | undefined>;
}

export interface AuditEventFilters {
  actorId?: string;
  action?: string;
  outcome?: AuditOutcome;
  severity?: AuditSeverity;
  resourceType?: AuditResourceType;
  resourceId?: string;
  clientId?: string;
  portfolioId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditEventPage {
  events: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AppendAuditEventInput {
  id: string;
  officeId: string;
  actorId?: string;
  actorName?: string;
  action: string;
  resourceType: AuditResourceType;
  resourceId: string;
  clientId?: string;
  portfolioId?: string;
  outcome: AuditOutcome;
  severity: AuditSeverity;
  reviewRequired: boolean;
  metadata: SafeAuditMetadata;
  createdAt: Date;
}

export interface SupervisionReviewFilters {
  status?: SupervisionReviewStatus;
  severity?: AuditSeverity;
  assignedToUserId?: string;
}

export interface UpdateSupervisionReviewInput {
  status?: SupervisionReviewStatus;
  assignedToUserId?: string;
  resolutionComment?: string;
  updatedAt: Date;
  resolvedAt?: Date;
}

export interface CreateAuditExportInput {
  id: string;
  officeId: string;
  requestedBy: string;
  format: AuditExportFormat;
  filters: SafeAuditMetadata;
  eventCount: number;
  createdAt: Date;
}

export interface AuditRepository {
  listAuditEvents(officeId: string, filters: AuditEventFilters): Promise<AuditEventPage>;
  findAuditEventById(auditEventId: string): Promise<AuditEvent | undefined>;
  appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEvent>;
  listSupervisionReviews(
    officeId: string,
    filters: SupervisionReviewFilters
  ): Promise<SupervisionReview[]>;
  findSupervisionReviewById(reviewId: string): Promise<SupervisionReview | undefined>;
  updateSupervisionReview(
    reviewId: string,
    input: UpdateSupervisionReviewInput
  ): Promise<SupervisionReview | undefined>;
  createAuditExport(input: CreateAuditExportInput): Promise<AuditExportJob>;
}

export interface CreatePortfolioInput {
  id: string;
  officeId: string;
  accountId: string;
  clientId?: string;
  householdId?: string;
  name: string;
  description?: string;
  baseCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdatePortfolioInput {
  name?: string;
  description?: string;
  updatedAt: Date;
}

export interface CreatePortfolioTransactionInput {
  id: string;
  portfolioId: string;
  assetSymbol: string;
  assetName: string;
  tradeDate: string;
  type: PortfolioTransaction["type"];
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  currency: string;
  notes?: string;
  idempotencyKey?: string;
  idempotencyFingerprint?: string;
  createdAt: Date;
}

export interface PortfolioTransactionIdempotencyRecord {
  transaction: PortfolioTransaction;
  requestFingerprint: string;
}

export interface PortfolioRepository {
  createPortfolio(input: CreatePortfolioInput): Promise<Portfolio>;
  updatePortfolio(id: string, input: UpdatePortfolioInput): Promise<Portfolio | undefined>;
  findPortfolioById(id: string): Promise<Portfolio | undefined>;
  listVisiblePortfolios(userId: string, isAdmin: boolean): Promise<PortfolioSummary[]>;
  findVisiblePortfolioDetail(
    portfolioId: string,
    userId: string,
    isAdmin: boolean
  ): Promise<PortfolioDetail | undefined>;
  listPortfolioTransactions(portfolioId: string): Promise<PortfolioTransaction[]>;
  createPortfolioTransaction(
    input: CreatePortfolioTransactionInput
  ): Promise<PortfolioTransaction>;
  findTransactionIdempotencyRecord(
    portfolioId: string,
    idempotencyKey: string
  ): Promise<PortfolioTransactionIdempotencyRecord | undefined>;
  listPortfolioPositions(portfolioId: string, asOfDate?: string): Promise<PortfolioPosition[]>;
  listPortfolioSnapshots(portfolioId: string): Promise<PortfolioSnapshot[]>;
  listOutboxEvents(): Promise<PortfolioOutboxEvent[]>;
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
