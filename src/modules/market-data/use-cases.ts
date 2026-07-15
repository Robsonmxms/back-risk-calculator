import { randomUUID } from "crypto";
import { Actor } from "../../01-domain/auth/actor";
import { assertAdmin } from "../../02-application/auth/policies";
import { ApplicationError } from "../../02-application/errors/application-error";
import { MetricsPort } from "../../02-application/ports/observability";
import {
  MarketDataEventPublisher,
  MarketDataJobQueue,
  MarketDataProvider,
  MarketDataRepository
} from "./ports";
import { MarketAsset, MarketDataJob, ProviderStatusSummary } from "./types";

export interface AssetSearchResult {
  assets: MarketAsset[];
  providerStatus: "available" | "degraded";
}

export class SearchMarketAssetsUseCase {
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly repository: MarketDataRepository,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(query: string, correlationId: string = randomUUID()): Promise<AssetSearchResult> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 1) {
      throw new ApplicationError(
        "invalid",
        "market_data.invalid_query",
        "Search query is required"
      );
    }

    const startedAt = this.now().getTime();
    try {
      const candidates = await this.provider.searchAssets(normalizedQuery);
      const assets = await this.repository.upsertAssets(candidates);
      await this.repository.recordProviderRequest({
        id: randomUUID(),
        providerName: this.provider.name,
        operation: "search_assets",
        status: "succeeded",
        latencyMs: this.now().getTime() - startedAt,
        correlationId,
        requestedAt: this.now()
      });
      this.metrics.increment("market_data.provider.search_assets.success");

      return { assets, providerStatus: "available" };
    } catch (error) {
      await this.repository.recordProviderRequest({
        id: randomUUID(),
        providerName: this.provider.name,
        operation: "search_assets",
        status: "failed",
        latencyMs: this.now().getTime() - startedAt,
        correlationId,
        errorCode: providerErrorCode(error),
        message: error instanceof Error ? error.message : undefined,
        requestedAt: this.now()
      });
      this.metrics.increment("market_data.provider.search_assets.failure");

      const fallbackAssets = await this.repository.searchAssets(normalizedQuery);
      if (fallbackAssets.length > 0) {
        return { assets: fallbackAssets, providerStatus: "degraded" };
      }

      throw new ApplicationError(
        "unavailable",
        "market_data.provider_unavailable",
        "Market data provider unavailable"
      );
    }
  }
}

export class GetMarketAssetUseCase {
  constructor(private readonly repository: MarketDataRepository) {}

  async execute(assetId: string) {
    const asset = await this.repository.findAssetById(assetId);
    if (!asset) {
      throw new ApplicationError("not_found", "market_data.asset_not_found", "Asset not found");
    }

    return {
      asset,
      latestQuote: await this.repository.findLatestQuote(asset.id)
    };
  }
}

export class RequestMarketDataRefreshUseCase {
  constructor(
    private readonly repository: MarketDataRepository,
    private readonly queue: MarketDataJobQueue,
    private readonly events: MarketDataEventPublisher,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    assetId: string,
    correlationId: string = randomUUID()
  ): Promise<MarketDataJob> {
    const asset = await this.repository.findAssetById(assetId);
    if (!asset) {
      throw new ApplicationError("not_found", "market_data.asset_not_found", "Asset not found");
    }

    const createdAt = this.now();
    const job = await this.queue.enqueue({
      id: randomUUID(),
      assetId: asset.id,
      symbol: asset.symbol,
      requestedBy: actor.id,
      correlationId,
      status: "queued",
      attempts: 0,
      createdAt,
      updatedAt: createdAt
    });
    await this.events.publish("MarketDataRequested", asset.id, {
      assetId: asset.id,
      symbol: asset.symbol,
      jobId: job.id,
      requestedBy: actor.id,
      correlationId
    });

    return job;
  }
}

export class GetMarketDataProviderStatusUseCase {
  constructor(
    private readonly repository: MarketDataRepository,
    private readonly provider: MarketDataProvider
  ) {}

  async execute(actor: Actor): Promise<ProviderStatusSummary> {
    assertAdmin(actor);
    return this.repository.getProviderStatus(this.provider.name);
  }
}

function providerErrorCode(error: unknown): string {
  if (error instanceof ApplicationError) {
    return error.code;
  }

  return "market_data.provider_error";
}
