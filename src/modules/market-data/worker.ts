import { randomUUID } from "crypto";
import { DateRange, LatestQuote, MarketDataJob } from "./types";
import {
  MarketDataCache,
  MarketDataEventPublisher,
  MarketDataJobQueue,
  MarketDataProvider,
  MarketDataRepository,
  PortfolioMarketDataProjection
} from "./ports";
import { MetricsPort, LoggerPort } from "../../02-application/ports/observability";

const LATEST_QUOTE_TTL_SECONDS = 30;
const HISTORICAL_TTL_SECONDS = 60 * 60;

export class MarketDataIngestionWorker {
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly repository: MarketDataRepository,
    private readonly cache: MarketDataCache,
    private readonly queue: MarketDataJobQueue,
    private readonly events: MarketDataEventPublisher,
    private readonly portfolios: PortfolioMarketDataProjection,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async processNext(): Promise<MarketDataJob | undefined> {
    const job = await this.queue.nextQueued();
    if (!job) {
      return undefined;
    }

    return this.processJob(job);
  }

  async processJob(job: MarketDataJob): Promise<MarketDataJob> {
    await this.queue.markRunning(job.id, this.now());
    const startedAt = this.now().getTime();

    try {
      const asset = await this.repository.findAssetById(job.assetId);
      if (!asset) {
        throw new Error("market_data.asset_not_found");
      }

      const range = defaultHistoricalRange(this.now());
      const quote = await this.resolveLatestQuote(asset.id, asset.symbol);
      const historicalPrices = await this.resolveHistoricalPrices(asset.symbol, range);
      const [dividends, splits] = await Promise.all([
        this.provider.getDividends(asset.symbol, range),
        this.provider.getSplits(asset.symbol, range)
      ]);

      await this.repository.upsertLatestQuote({
        ...quote,
        assetId: asset.id,
        symbol: asset.symbol,
        updatedAt: this.now()
      });
      await this.repository.upsertHistoricalPrices(
        historicalPrices.map((price) => ({
          ...price,
          assetId: asset.id,
          symbol: asset.symbol,
          updatedAt: this.now()
        }))
      );
      await this.repository.upsertDividends(
        dividends.map((dividend) => ({
          ...dividend,
          assetId: asset.id,
          symbol: asset.symbol,
          updatedAt: this.now()
        }))
      );
      await this.repository.upsertSplits(
        splits.map((split) => ({
          ...split,
          assetId: asset.id,
          symbol: asset.symbol,
          updatedAt: this.now()
        }))
      );

      await this.repository.recordProviderRequest({
        id: randomUUID(),
        providerName: this.provider.name,
        operation: "latest_quote",
        symbol: asset.symbol,
        status: "succeeded",
        latencyMs: this.now().getTime() - startedAt,
        correlationId: job.correlationId,
        requestedAt: this.now()
      });

      await this.portfolios.markMarketDataRefreshSucceeded(asset.symbol, quote.asOf);
      const portfolioIds = await this.portfolios.listPortfolioIdsHoldingAsset(asset.symbol);
      await this.events.publish("MarketDataUpdated", asset.id, {
        assetId: asset.id,
        symbol: asset.symbol,
        providerName: this.provider.name,
        portfolioIds,
        correlationId: job.correlationId
      });

      for (const portfolioId of portfolioIds) {
        await this.events.publish("AnalyticsRequested", portfolioId, {
          portfolioId,
          assetId: asset.id,
          symbol: asset.symbol,
          correlationId: job.correlationId
        });
      }

      this.metrics.increment("market_data.refresh.success");
      this.logger.info("market_data.refresh.succeeded", {
        providerName: this.provider.name,
        symbol: asset.symbol,
        correlationId: job.correlationId,
        latencyMs: this.now().getTime() - startedAt
      });

      return (await this.queue.markSucceeded(job.id, this.now())) ?? job;
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "market_data.provider_error";
      await this.repository.recordProviderRequest({
        id: randomUUID(),
        providerName: this.provider.name,
        operation: "latest_quote",
        symbol: job.symbol,
        status: "failed",
        latencyMs: this.now().getTime() - startedAt,
        correlationId: job.correlationId,
        errorCode,
        message: error instanceof Error ? error.message : undefined,
        requestedAt: this.now()
      });
      await this.portfolios.markMarketDataRefreshFailed(job.symbol, errorCode, this.now());
      await this.events.publish("MarketDataFailed", job.assetId, {
        assetId: job.assetId,
        symbol: job.symbol,
        providerName: this.provider.name,
        correlationId: job.correlationId,
        errorCode
      });
      this.metrics.increment("market_data.refresh.failure");
      this.logger.warn("market_data.refresh.failed", {
        providerName: this.provider.name,
        symbol: job.symbol,
        correlationId: job.correlationId,
        errorCode
      });

      return (await this.queue.markFailed(job.id, this.now(), errorCode)) ?? job;
    }
  }

  private async resolveLatestQuote(assetId: string, symbol: string): Promise<LatestQuote> {
    const cached = await this.cache.getLatestQuote(symbol);
    if (cached) {
      this.metrics.increment("market_data.cache.latest_quote.hit");
      return cached;
    }

    const stored = await this.repository.findLatestQuote(assetId);
    if (
      stored &&
      this.now().getTime() - stored.updatedAt.getTime() <= LATEST_QUOTE_TTL_SECONDS * 1000
    ) {
      this.metrics.increment("market_data.cache.latest_quote.stored_hit");
      await this.cache.setLatestQuote(symbol, stored, LATEST_QUOTE_TTL_SECONDS);
      return stored;
    }

    this.metrics.increment("market_data.cache.latest_quote.miss");
    const quote = await this.provider.getLatestQuote(symbol);
    await this.cache.setLatestQuote(symbol, quote, LATEST_QUOTE_TTL_SECONDS);
    return quote;
  }

  private async resolveHistoricalPrices(symbol: string, range: DateRange) {
    const cached = await this.cache.getHistoricalPrices(symbol, range);
    if (cached) {
      this.metrics.increment("market_data.cache.historical_prices.hit");
      return cached;
    }

    this.metrics.increment("market_data.cache.historical_prices.miss");
    const prices = await this.provider.getHistoricalPrices(symbol, range);
    await this.cache.setHistoricalPrices(symbol, range, prices, HISTORICAL_TTL_SECONDS);
    return prices;
  }
}

export class MarketDataScheduler {
  constructor(
    private readonly portfolios: PortfolioMarketDataProjection,
    private readonly repository: MarketDataRepository,
    private readonly queue: MarketDataJobQueue,
    private readonly now: () => Date = () => new Date()
  ) {}

  async refreshTrackedAssetsAfterMarketClose(correlationId: string = randomUUID()) {
    const symbols = await this.portfolios.listTrackedAssetSymbols();
    const queued: MarketDataJob[] = [];

    for (const symbol of symbols) {
      const asset = await this.repository.findAssetBySymbol(symbol);
      if (!asset) {
        continue;
      }

      const queuedAt = this.now();
      queued.push(
        await this.queue.enqueue({
          id: randomUUID(),
          assetId: asset.id,
          symbol: asset.symbol,
          requestedBy: "scheduler",
          correlationId,
          status: "queued",
          attempts: 0,
          createdAt: queuedAt,
          updatedAt: queuedAt
        })
      );
    }

    return queued;
  }
}

function defaultHistoricalRange(now: Date): DateRange {
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - 30);

  return {
    from: fromDate.toISOString().slice(0, 10),
    to
  };
}
