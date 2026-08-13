import {
  AllocationPoint,
  CorrelationCell,
  DataQualityIssue,
  DrawdownPoint,
  SectorExposurePoint,
  TimeSeriesPoint
} from "../../01-domain/analytics/types";

export type PortfolioChartRange = "1m" | "3m" | "6m" | "ytd" | "1y" | "3y" | "5y" | "all";
export type PortfolioChartInterval = "daily" | "weekly" | "monthly";
export type PortfolioChartDataQualityStatus = "complete" | "partial" | "pending" | "failed";

export interface PortfolioChartsQuery {
  range: PortfolioChartRange;
  interval: PortfolioChartInterval;
  baseCurrency?: string;
  assetSymbols?: string;
  benchmarkSymbol?: string;
  include?: string;
}

export interface AssetPriceChartPoint {
  date: string;
  close: number;
  adjustedClose: number;
}

export interface AssetPriceChartSeries {
  assetId: string;
  symbol: string;
  name: string;
  currency: string;
  providerName: string;
  freshness: "fresh" | "partial" | "stale";
  points: AssetPriceChartPoint[];
}

export interface CumulativeReturnPoint {
  date: string;
  returnPercent: number;
}

export interface RollingRiskPoint {
  date: string;
  volatilityPercent: number;
  rollingReturnPercent: number;
  sampleSize: number;
}

export interface BenchmarkComparisonPoint {
  date: string;
  symbol: string;
  returnPercent: number;
}

export interface ChartAnnotation {
  id: string;
  date: string;
  type: "transaction" | "analytics" | "market_data" | "report" | "alert";
  label: string;
  portfolioId: string;
  relatedId?: string;
}

export interface PortfolioChartBundle {
  portfolioId: string;
  asOfDate: string;
  range: PortfolioChartRange;
  interval: PortfolioChartInterval;
  baseCurrency: string;
  charts: {
    assetPrices: AssetPriceChartSeries[];
    portfolioPerformance: TimeSeriesPoint[];
    cumulativeReturn: CumulativeReturnPoint[];
    allocation: AllocationPoint[];
    sectorExposure: SectorExposurePoint[];
    drawdown: DrawdownPoint[];
    rollingRisk: RollingRiskPoint[];
    correlation: {
      symbols: string[];
      cells: CorrelationCell[];
    };
    benchmarkComparison: BenchmarkComparisonPoint[];
    annotations: ChartAnnotation[];
  };
  dataQuality: {
    status: PortfolioChartDataQualityStatus;
    issues: DataQualityIssue[];
    staleInputCount: number;
    unavailableChartKeys: string[];
  };
}

export interface PortfolioChartResponse {
  data: PortfolioChartBundle;
  meta: {
    sourceSnapshotId?: string;
    generatedAt: string;
    latestJobStatus?: string;
  };
}
