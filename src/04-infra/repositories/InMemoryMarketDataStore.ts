import {
  MarketDataEventPublisher,
  MarketDataJobQueue,
  MarketDataRepository
} from "../../modules/market-data/ports";
import {
  Dividend,
  HistoricalPrice,
  LatestQuote,
  MarketAsset,
  MarketAssetCandidate,
  MarketDataJob,
  ProviderRequestLog,
  ProviderStatusSummary,
  Split
} from "../../modules/market-data/types";

export class InMemoryMarketDataStore
  implements MarketDataRepository, MarketDataJobQueue, MarketDataEventPublisher
{
  private readonly assetsById = new Map<string, MarketAsset>();
  private readonly assetIdBySymbol = new Map<string, string>();
  private readonly latestQuotesByAssetId = new Map<string, LatestQuote>();
  private readonly historicalPricesByKey = new Map<string, HistoricalPrice>();
  private readonly dividendsByKey = new Map<string, Dividend>();
  private readonly splitsByKey = new Map<string, Split>();
  private readonly providerRequests: ProviderRequestLog[] = [];
  private readonly jobs = new Map<string, MarketDataJob>();
  private readonly events: Array<{
    topic: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    createdAt: Date;
  }> = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async upsertAssets(assets: MarketAssetCandidate[]): Promise<MarketAsset[]> {
    return assets.map((asset) => {
      const normalized: MarketAsset = {
        ...asset,
        symbol: asset.symbol.toUpperCase(),
        providerSymbol: asset.providerSymbol.toUpperCase(),
        updatedAt: asset.updatedAt ?? this.now()
      };
      this.assetsById.set(normalized.id, normalized);
      this.assetIdBySymbol.set(normalized.symbol, normalized.id);
      return normalized;
    });
  }

  async searchAssets(query: string): Promise<MarketAsset[]> {
    const normalizedQuery = query.trim().toUpperCase();
    return Array.from(this.assetsById.values()).filter(
      (asset) =>
        asset.symbol.includes(normalizedQuery) ||
        asset.name.toUpperCase().includes(normalizedQuery)
    );
  }

  async findAssetById(assetId: string): Promise<MarketAsset | undefined> {
    return this.assetsById.get(assetId);
  }

  async findAssetBySymbol(symbol: string): Promise<MarketAsset | undefined> {
    const assetId = this.assetIdBySymbol.get(symbol.toUpperCase());
    return assetId ? this.assetsById.get(assetId) : undefined;
  }

  async upsertLatestQuote(quote: LatestQuote): Promise<LatestQuote> {
    this.latestQuotesByAssetId.set(quote.assetId, quote);
    return quote;
  }

  async findLatestQuote(assetId: string): Promise<LatestQuote | undefined> {
    return this.latestQuotesByAssetId.get(assetId);
  }

  async upsertHistoricalPrices(prices: HistoricalPrice[]): Promise<void> {
    for (const price of prices) {
      this.historicalPricesByKey.set(`${price.assetId}:${price.date}`, price);
    }
  }

  async listHistoricalPrices(assetId: string): Promise<HistoricalPrice[]> {
    return Array.from(this.historicalPricesByKey.values())
      .filter((price) => price.assetId === assetId)
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  async upsertDividends(dividends: Dividend[]): Promise<void> {
    for (const dividend of dividends) {
      this.dividendsByKey.set(`${dividend.assetId}:${dividend.exDate}`, dividend);
    }
  }

  async upsertSplits(splits: Split[]): Promise<void> {
    for (const split of splits) {
      this.splitsByKey.set(`${split.assetId}:${split.date}`, split);
    }
  }

  async recordProviderRequest(log: ProviderRequestLog): Promise<void> {
    this.providerRequests.push(log);
  }

  async listProviderRequests(): Promise<ProviderRequestLog[]> {
    return [...this.providerRequests];
  }

  async getProviderStatus(providerName: string): Promise<ProviderStatusSummary> {
    const requests = this.providerRequests.filter(
      (request) => request.providerName === providerName
    );
    const failures = requests.filter((request) => request.status === "failed");
    const lastSuccess = [...requests]
      .reverse()
      .find((request) => request.status === "succeeded");
    const lastFailure = [...requests]
      .reverse()
      .find((request) => request.status === "failed");
    const averageLatencyMs =
      requests.length === 0
        ? 0
        : Math.round(
            requests.reduce((sum, request) => sum + request.latencyMs, 0) / requests.length
          );

    return {
      providerName,
      status: failures.length === 0 ? "available" : lastSuccess ? "degraded" : "unavailable",
      lastSuccessAt: lastSuccess?.requestedAt.toISOString(),
      lastFailureAt: lastFailure?.requestedAt.toISOString(),
      lastErrorCode: lastFailure?.errorCode,
      requestCount: requests.length,
      errorCount: failures.length,
      averageLatencyMs
    };
  }

  async enqueue(job: MarketDataJob): Promise<MarketDataJob> {
    this.jobs.set(job.id, job);
    return job;
  }

  async nextQueued(): Promise<MarketDataJob | undefined> {
    return Array.from(this.jobs.values())
      .filter((job) => job.status === "queued")
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
  }

  async markRunning(jobId: string, updatedAt: Date): Promise<MarketDataJob | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    job.status = "running";
    job.attempts += 1;
    job.updatedAt = updatedAt;
    return job;
  }

  async markSucceeded(jobId: string, completedAt: Date): Promise<MarketDataJob | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    job.status = "succeeded";
    job.updatedAt = completedAt;
    job.completedAt = completedAt;
    return job;
  }

  async markFailed(
    jobId: string,
    completedAt: Date,
    errorCode: string
  ): Promise<MarketDataJob | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    job.status = "failed";
    job.updatedAt = completedAt;
    job.completedAt = completedAt;
    job.errorCode = errorCode;
    return job;
  }

  async listJobs(): Promise<MarketDataJob[]> {
    return [...this.jobs.values()];
  }

  async publish(
    topic: string,
    aggregateId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    this.events.push({ topic, aggregateId, payload, createdAt: this.now() });
  }

  async listEvents(): Promise<Array<{ topic: string; aggregateId: string }>> {
    return this.events.map((event) => ({
      topic: event.topic,
      aggregateId: event.aggregateId
    }));
  }
}
