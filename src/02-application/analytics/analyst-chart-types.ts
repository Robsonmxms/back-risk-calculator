import { AnalyticsMetricKey, DataQualityIssue } from "../../01-domain/analytics/types";

export type AnalystChartRange = "90d" | "ytd" | "1y" | "3y" | "5y" | "all";
export type AnalystDataQualityFilter = "complete" | "partial" | "stale" | "failed";
export type AnalystChartDataQualityStatus = AnalystDataQualityFilter | "empty";
export type AnalystChartJobStatus = "pending" | "running" | "succeeded" | "failed" | "expired";

export interface AnalystChartsQuery {
  portfolioIds?: string;
  clientId?: string;
  householdId?: string;
  accountId?: string;
  advisorUserId?: string;
  teamId?: string;
  range: AnalystChartRange;
  metrics?: string;
  benchmarkSymbol?: string;
  dataQuality?: AnalystDataQualityFilter;
}

export interface AnalystPortfolioReference {
  portfolioId: string;
  portfolioName: string;
  accountId: string;
  accountName: string;
  clientId?: string;
  clientName?: string;
  householdId?: string;
  householdName?: string;
}

export interface AnalystRiskReturnPoint extends AnalystPortfolioReference {
  valueUsd: number;
  annualizedReturnPercent?: number;
  volatilityPercent?: number;
  maxDrawdownPercent?: number;
  beta?: number;
  sharpeRatio?: number;
  concentrationHhi?: number;
  dataQualityStatus: AnalystChartDataQualityStatus;
}

export interface AnalystMetricDistributionBucket {
  label: string;
  min?: number;
  max?: number;
  count: number;
  portfolioIds: string[];
  unavailableReason?: string;
}

export interface AnalystMetricDistribution {
  metricKey: AnalyticsMetricKey;
  unit: "percent" | "ratio" | "score" | "currency";
  buckets: AnalystMetricDistributionBucket[];
}

export interface AnalystRollingPoint extends AnalystPortfolioReference {
  date: string;
  value: number;
  sampleSize: number;
}

export interface AnalystCorrelationPoint extends AnalystPortfolioReference {
  date: string;
  leftSymbol: string;
  rightSymbol: string;
  correlation: number;
}

export interface AnalystExposureHeatmapCell extends AnalystPortfolioReference {
  label: string;
  weightPercent: number;
  marketValueUsd: number;
}

export interface AnalystBenchmarkSensitivityPoint extends AnalystPortfolioReference {
  benchmarkSymbol: string;
  portfolioReturnPercent?: number;
  benchmarkReturnPercent?: number;
  beta?: number;
  sensitivity?: number;
  unavailableReason?: string;
}

export interface AnalystRiskContributionPoint extends AnalystPortfolioReference {
  label: string;
  weightPercent: number;
  riskContributionPercent?: number;
  unavailableReason?: string;
}

export interface AnalystConcentrationRankingItem extends AnalystPortfolioReference {
  rank: number;
  concentrationHhi?: number;
  topHoldingLabel?: string;
  topHoldingWeightPercent?: number;
  unavailableReason?: string;
}

export interface AnalystDataQualityTimelinePoint extends AnalystPortfolioReference {
  date: string;
  status: AnalystChartDataQualityStatus;
  issueCode?: string;
  severity?: DataQualityIssue["severity"];
  message?: string;
}

export interface AnalystProviderFreshnessCell extends AnalystPortfolioReference {
  symbol: string;
  providerName?: string;
  freshness: "fresh" | "partial" | "stale" | "missing";
  asOf?: string;
  issueCode?: string;
}

export interface AnalystChartBundle {
  officeId: string;
  range: AnalystChartRange;
  filters: {
    portfolioIds: string[];
    clientId?: string;
    householdId?: string;
    accountId?: string;
    advisorUserId?: string;
    teamId?: string;
    metrics: AnalyticsMetricKey[];
    benchmarkSymbol?: string;
    dataQuality?: AnalystDataQualityFilter;
  };
  charts: {
    riskReturnScatter: AnalystRiskReturnPoint[];
    metricDistributions: AnalystMetricDistribution[];
    rollingVolatility: AnalystRollingPoint[];
    rollingCorrelation: AnalystCorrelationPoint[];
    sectorExposureHeatmap: AnalystExposureHeatmapCell[];
    assetExposureHeatmap: AnalystExposureHeatmapCell[];
    benchmarkSensitivity: AnalystBenchmarkSensitivityPoint[];
    riskContribution: AnalystRiskContributionPoint[];
    concentrationRanking: AnalystConcentrationRankingItem[];
    dataQualityTimeline: AnalystDataQualityTimelinePoint[];
    providerFreshnessMatrix: AnalystProviderFreshnessCell[];
  };
  dataQuality: {
    status: AnalystChartDataQualityStatus;
    issues: DataQualityIssue[];
    unavailableChartKeys: string[];
    sourceCounts: {
      portfolios: number;
      snapshots: number;
      analyticsJobs: number;
      assets: number;
    };
  };
}

export interface AnalystChartsResponse {
  data: AnalystChartBundle;
  meta: {
    generatedAt: string;
    sourceSnapshotIds: string[];
    inputHashes: string[];
    calculationDurationMs: number;
  };
}

export interface AnalystChartJob {
  id: string;
  officeId: string;
  requestedBy: string;
  idempotencyKey: string;
  filters: AnalystChartsQuery;
  inputHash: string;
  correlationId: string;
  status: AnalystChartJobStatus;
  progressPercent: number;
  sourceSnapshotIds: string[];
  resultMetadata?: {
    portfolioCount: number;
    chartKeys: string[];
    lastSuccessfulResultAt?: string;
  };
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  expiresAt?: Date;
}

export interface AnalystChartJobRepository {
  createJob(job: AnalystChartJob): Promise<AnalystChartJob>;
  findJobById(jobId: string): Promise<AnalystChartJob | undefined>;
  findJobByIdempotencyKey(
    officeId: string,
    requestedBy: string,
    idempotencyKey: string
  ): Promise<AnalystChartJob | undefined>;
  updateJob(
    jobId: string,
    input: Partial<
      Pick<
        AnalystChartJob,
        | "status"
        | "progressPercent"
        | "sourceSnapshotIds"
        | "resultMetadata"
        | "errorCode"
        | "updatedAt"
        | "completedAt"
        | "expiresAt"
      >
    >
  ): Promise<AnalystChartJob | undefined>;
  listJobsByOffice(officeId: string): Promise<AnalystChartJob[]>;
}
