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

export interface CreatePortfolioInput {
  id: string;
  officeId: string;
  accountId: string;
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
