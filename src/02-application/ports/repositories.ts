import {
  Account,
  AccountMember,
  AccountMembershipSummary,
  PortfolioAccountSnapshot
} from "../../01-domain/accounts/account";
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

export interface CreatePortfolioInput {
  id: string;
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
  createdAt: Date;
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
  findTransactionByIdempotencyKey(
    portfolioId: string,
    idempotencyKey: string
  ): Promise<PortfolioTransaction | undefined>;
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
