import {
  DateRange,
  Dividend,
  ExchangeRate,
  HistoricalPrice,
  LatestQuote,
  MarketAsset,
  MarketAssetCandidate,
  MarketDataJob,
  ProviderRequestLog,
  ProviderStatusSummary,
  Split
} from "../../01-domain/market-data/types";

export interface MarketDataProvider {
  readonly name: string;
  searchAssets(query: string): Promise<MarketAssetCandidate[]>;
  getLatestQuote(symbol: string): Promise<LatestQuote>;
  getHistoricalPrices(symbol: string, range: DateRange): Promise<HistoricalPrice[]>;
  getDividends(symbol: string, range: DateRange): Promise<Dividend[]>;
  getSplits(symbol: string, range: DateRange): Promise<Split[]>;
}

export interface CurrencyRateProvider {
  readonly name: string;
  getExchangeRate(from: string, to: string): Promise<ExchangeRate>;
}

export interface MarketDataCache {
  getLatestQuote(symbol: string): Promise<LatestQuote | undefined>;
  setLatestQuote(symbol: string, quote: LatestQuote, ttlSeconds: number): Promise<void>;
  getHistoricalPrices(symbol: string, range: DateRange): Promise<HistoricalPrice[] | undefined>;
  setHistoricalPrices(
    symbol: string,
    range: DateRange,
    prices: HistoricalPrice[],
    ttlSeconds: number
  ): Promise<void>;
}

export interface MarketDataRepository {
  upsertAssets(assets: MarketAssetCandidate[]): Promise<MarketAsset[]>;
  searchAssets(query: string): Promise<MarketAsset[]>;
  findAssetById(assetId: string): Promise<MarketAsset | undefined>;
  findAssetBySymbol(symbol: string): Promise<MarketAsset | undefined>;
  upsertLatestQuote(quote: LatestQuote): Promise<LatestQuote>;
  findLatestQuote(assetId: string): Promise<LatestQuote | undefined>;
  upsertHistoricalPrices(prices: HistoricalPrice[]): Promise<void>;
  listHistoricalPrices(assetId: string): Promise<HistoricalPrice[]>;
  upsertDividends(dividends: Dividend[]): Promise<void>;
  upsertSplits(splits: Split[]): Promise<void>;
  recordProviderRequest(log: ProviderRequestLog): Promise<void>;
  listProviderRequests(): Promise<ProviderRequestLog[]>;
  getProviderStatus(providerName: string): Promise<ProviderStatusSummary>;
}

export interface MarketDataJobQueue {
  enqueue(job: MarketDataJob): Promise<MarketDataJob>;
  nextQueued(): Promise<MarketDataJob | undefined>;
  markRunning(jobId: string, updatedAt: Date): Promise<MarketDataJob | undefined>;
  markSucceeded(jobId: string, completedAt: Date): Promise<MarketDataJob | undefined>;
  markFailed(
    jobId: string,
    completedAt: Date,
    errorCode: string
  ): Promise<MarketDataJob | undefined>;
  listJobs(): Promise<MarketDataJob[]>;
}

export interface MarketDataEventPublisher {
  publish(topic: string, aggregateId: string, payload: Record<string, unknown>): Promise<void>;
}

export interface PortfolioMarketDataProjection {
  listTrackedAssetSymbols(): Promise<string[]>;
  listPortfolioIdsHoldingAsset(symbol: string): Promise<string[]>;
  markMarketDataRefreshSucceeded(symbol: string, refreshedAt: Date): Promise<void>;
  markMarketDataRefreshFailed(symbol: string, errorCode: string, failedAt: Date): Promise<void>;
}
