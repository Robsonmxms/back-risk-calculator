export type AccountMemberRole = "owner" | "analyst" | "viewer";
export type AccountDataFreshness = "fresh" | "stale" | "partial";
export type AccountDataStatus = "ready" | "syncing" | "degraded";
export type ReportStatus = "ready" | "generating";
export type AlertSeverity = "low" | "medium" | "high";

export interface Account {
  id: string;
  officeId: string;
  clientId?: string;
  householdId?: string;
  name: string;
  ownerUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountMember {
  id: string;
  accountId: string;
  userId: string;
  role: AccountMemberRole;
  createdAt: Date;
}

export interface AccountMembershipSummary {
  accountId: string;
  officeId: string;
  accountName: string;
  role: AccountMemberRole;
}

export interface AccountDataMeta {
  status: AccountDataStatus;
  freshness: AccountDataFreshness;
  asOf: string;
  lastSuccessfulSyncAt: string;
  warnings: string[];
}

export interface PortfolioHolding {
  symbol: string;
  name: string;
  assetClass: string;
  quantity: number;
  weightPercent: number;
  marketValue: number;
  dayChangePercent: number;
}

export interface PortfolioTransaction {
  id: string;
  tradeDate: string;
  type: "buy" | "sell" | "dividend" | "rebalance";
  description: string;
  quantity: number;
  amount: number;
  currency: string;
  status: "posted" | "pending";
}

export interface AnalyticsMetricSet {
  riskScore: number;
  volatilityPercent: number;
  valueAtRisk95: number;
  maxDrawdownPercent: number;
  diversificationScore: number;
  notes: string[];
}

export interface AllocationSlice {
  label: string;
  weightPercent: number;
}

export interface PerformancePoint {
  label: string;
  returnPercent: number;
}

export interface ReportSummary {
  id: string;
  name: string;
  asOf: string;
  status: ReportStatus;
  format: "pdf" | "csv";
}

export interface AlertSummary {
  id: string;
  title: string;
  severity: AlertSeverity;
  status: "open" | "monitoring";
}

export interface PortfolioAccountSnapshot {
  accountId: string;
  officeId: string;
  accountName: string;
  membershipRole: AccountMemberRole;
  currency: string;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  dayChangePercent: number;
  holdingsCount: number;
  openAlerts: number;
  reportStatus: ReportStatus;
  analytics: AnalyticsMetricSet;
  allocation: AllocationSlice[];
  performance: PerformancePoint[];
  holdings: PortfolioHolding[];
  transactions: PortfolioTransaction[];
  reports: ReportSummary[];
  alerts: AlertSummary[];
  insights: string[];
  meta: AccountDataMeta;
}
