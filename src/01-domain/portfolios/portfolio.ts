import { AccountDataFreshness, AccountDataStatus, AccountMemberRole } from "../accounts/account";

export type PortfolioTransactionType = "buy" | "sell";
export type PortfolioProcessingState = "ready" | "pending";

export interface Portfolio {
  id: string;
  officeId: string;
  accountId: string;
  name: string;
  description?: string;
  baseCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioTransaction {
  id: string;
  portfolioId: string;
  assetSymbol: string;
  assetName: string;
  tradeDate: string;
  type: PortfolioTransactionType;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  currency: string;
  notes?: string;
  idempotencyKey?: string;
  createdAt: Date;
}

export interface PortfolioPosition {
  portfolioId: string;
  assetSymbol: string;
  assetName: string;
  quantity: number;
  averageCost: number;
  totalCostBasis: number;
  currency: string;
  lastTransactionDate: string;
}

export interface PortfolioSnapshot {
  id: string;
  portfolioId: string;
  asOfDate: string;
  createdAt: Date;
  positions: PortfolioPosition[];
  transactionCount: number;
  totalCostBasis: number;
}

export interface PortfolioOutboxEvent {
  id: string;
  topic: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface PortfolioSummary {
  id: string;
  officeId: string;
  accountId: string;
  accountName: string;
  name: string;
  description?: string;
  baseCurrency: string;
  membershipRole: AccountMemberRole;
  holdingsCount: number;
  transactionCount: number;
  totalCostBasis: number;
  freshness: AccountDataFreshness;
  status: AccountDataStatus;
  analyticsState: PortfolioProcessingState;
  marketDataState: PortfolioProcessingState;
  lastTransactionDate?: string;
}

export interface PortfolioDetail extends PortfolioSummary {
  createdAt: string;
  updatedAt: string;
  warnings: string[];
}
