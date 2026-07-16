export type MarketAssetType = "stock" | "etf" | "fund" | "crypto";
export type MarketDataFreshness = "fresh" | "partial" | "stale";
export type MarketDataRequestStatus = "queued" | "running" | "succeeded" | "failed";
export type ProviderRequestOperation =
  | "search_assets"
  | "latest_quote"
  | "historical_prices"
  | "dividends"
  | "splits"
  | "currency_rate";

export interface DateRange {
  from: string;
  to: string;
}

export interface MarketAsset {
  id: string;
  symbol: string;
  providerSymbol: string;
  name: string;
  exchange?: string;
  currency: string;
  assetType: MarketAssetType;
  region?: string;
  sector?: string;
  providerName: string;
  isActive: boolean;
  updatedAt: Date;
}

export interface MarketAssetSearchItem extends MarketAsset {
  latestQuote?: LatestQuote;
}

export interface MarketExchange {
  code: string;
  name: string;
  country: string;
  currency: string;
  yahooSuffix: string;
  aliases: string[];
}

export interface MarketAssetCandidate extends Omit<MarketAsset, "updatedAt"> {
  updatedAt?: Date;
}

export interface LatestQuote {
  assetId: string;
  symbol: string;
  providerName: string;
  currency: string;
  price: number;
  asOf: Date;
  freshness: MarketDataFreshness;
  updatedAt: Date;
}

export interface HistoricalPrice {
  assetId: string;
  symbol: string;
  providerName: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number;
  volume: number;
  currency: string;
  updatedAt: Date;
}

export interface Dividend {
  assetId: string;
  symbol: string;
  providerName: string;
  exDate: string;
  paymentDate?: string;
  amount: number;
  currency: string;
  updatedAt: Date;
}

export interface Split {
  assetId: string;
  symbol: string;
  providerName: string;
  date: string;
  ratio: number;
  numerator: number;
  denominator: number;
  updatedAt: Date;
}

export interface ExchangeRate {
  from: string;
  to: string;
  rate: number;
  providerName: string;
  asOf: Date;
  updatedAt: Date;
}

export interface TradePriceQuote {
  assetId: string;
  symbol: string;
  tradeDate: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  currency: string;
  providerName: string;
  priceSource: "latest_quote" | "historical_close";
  asOf: Date;
}

export interface ProviderRequestLog {
  id: string;
  providerName: string;
  operation: ProviderRequestOperation;
  symbol?: string;
  status: "succeeded" | "failed";
  latencyMs: number;
  correlationId: string;
  errorCode?: string;
  message?: string;
  requestedAt: Date;
}

export interface MarketDataJob {
  id: string;
  assetId: string;
  symbol: string;
  requestedBy: string;
  correlationId: string;
  status: MarketDataRequestStatus;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  errorCode?: string;
}

export interface ProviderStatusSummary {
  providerName: string;
  status: "available" | "degraded" | "unavailable";
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: string;
  requestCount: number;
  errorCount: number;
  averageLatencyMs: number;
}
