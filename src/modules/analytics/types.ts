import { PortfolioPosition } from "../../01-domain/portfolios/portfolio";

export type AnalyticsJobStatus = "queued" | "running" | "succeeded" | "failed";
export type AnalyticsSnapshotStatus = "complete" | "partial";
export type AnalyticsReadStatus = AnalyticsSnapshotStatus | "pending" | "failed";
export type AnalyticsMetricStatus = "available" | "unavailable";
export type AnalyticsMetricUnit = "percent" | "ratio" | "currency" | "score";
export type DataQualitySeverity = "info" | "warning" | "blocking";
export type RiskInsightSeverity = "info" | "watch" | "high";

export type AnalyticsMetricKey =
  | "totalReturn"
  | "annualizedReturn"
  | "maxDrawdown"
  | "volatility"
  | "beta"
  | "sharpeRatio"
  | "concentrationHhi"
  | "sectorExposure"
  | "assetCorrelation";

export interface AnalyticsJob {
  id: string;
  portfolioId: string;
  requestedBy: string;
  correlationId: string;
  status: AnalyticsJobStatus;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  errorCode?: string;
}

export interface AnalyticsMetric {
  key: AnalyticsMetricKey;
  label: string;
  unit: AnalyticsMetricUnit;
  status: AnalyticsMetricStatus;
  value?: number;
  reason?: string;
  assumptions: string[];
  requiredData: string[];
}

export type AnalyticsMetricSet = Record<AnalyticsMetricKey, AnalyticsMetric>;

export interface DataQualityIssue {
  code: string;
  severity: DataQualitySeverity;
  message: string;
  symbols?: string[];
  metricKeys?: AnalyticsMetricKey[];
}

export interface AnalyticsPosition {
  portfolioId: string;
  assetSymbol: string;
  assetName: string;
  quantity: number;
  currency: string;
  exchange?: string;
  sector: string;
  latestPrice?: number;
  latestPriceCurrency?: string;
  marketValueUsd?: number;
  costBasisUsd?: number;
  weightPercent?: number;
  dataQuality: DataQualityIssue[];
}

export interface AllocationPoint {
  symbol: string;
  name: string;
  weightPercent: number;
  marketValueUsd: number;
}

export interface SectorExposurePoint {
  sector: string;
  weightPercent: number;
  marketValueUsd: number;
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface DrawdownPoint {
  date: string;
  drawdownPercent: number;
}

export interface CorrelationCell {
  leftSymbol: string;
  rightSymbol: string;
  correlation: number;
}

export interface RiskInsight {
  id: string;
  severity: RiskInsightSeverity;
  title: string;
  explanation: string;
  metricKeys: AnalyticsMetricKey[];
  symbols?: string[];
}

export interface CurrencyConversionAudit {
  from: string;
  to: "USD";
  rate: number;
  providerName: string;
  asOf: Date;
}

export interface PortfolioAnalyticsSnapshot {
  id: string;
  portfolioId: string;
  asOfDate: string;
  generatedAt: Date;
  baseCurrency: "USD";
  status: AnalyticsSnapshotStatus;
  metrics: AnalyticsMetricSet;
  positions: AnalyticsPosition[];
  allocation: AllocationPoint[];
  sectorExposure: SectorExposurePoint[];
  performance: TimeSeriesPoint[];
  drawdown: DrawdownPoint[];
  correlation: CorrelationCell[];
  insights: RiskInsight[];
  dataQuality: {
    issues: DataQualityIssue[];
    unavailableMetricCount: number;
    staleInputCount: number;
    conversionRates: CurrencyConversionAudit[];
  };
  inputHash: string;
  calculationDurationMs: number;
}

export interface PortfolioAnalyticsReadModel {
  portfolioId: string;
  status: AnalyticsReadStatus;
  baseCurrency: "USD";
  snapshot: PortfolioAnalyticsSnapshot | null;
  lastSuccessfulSnapshot: PortfolioAnalyticsSnapshot | null;
  failedJob?: AnalyticsJob;
}

export interface AnalyticsComputationInput {
  portfolioId: string;
  positions: PortfolioPosition[];
}
