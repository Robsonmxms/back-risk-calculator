import { randomUUID } from "crypto";
import { Actor } from "../../01-domain/auth/actor";
import { assertAdmin } from "../../02-application/auth/policies";
import { ApplicationError } from "../../02-application/errors/application-error";
import { MetricsPort } from "../../02-application/ports/observability";
import {
  assetMatchesExchange,
  findMarketExchange,
  MARKET_EXCHANGES,
  symbolForExchangeQuery
} from "./exchanges";
import {
  CurrencyRateProvider,
  MarketDataEventPublisher,
  MarketDataJobQueue,
  MarketDataProvider,
  MarketDataRepository
} from "./ports";
import {
  ExchangeRate,
  HistoricalPrice,
  LatestQuote,
  MarketAsset,
  MarketAssetCandidate,
  MarketDataJob,
  MarketExchange,
  MarketAssetSearchItem,
  ProviderStatusSummary,
  TradePriceQuote
} from "./types";

export interface AssetSearchResult {
  assets: MarketAssetSearchItem[];
  providerStatus: "available" | "degraded";
  exchange?: MarketExchange;
}

export interface AssetSearchInput {
  query: string;
  exchangeCode?: string;
}

export class SearchMarketAssetsUseCase {
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly repository: MarketDataRepository,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    input: string | AssetSearchInput,
    correlationId: string = randomUUID()
  ): Promise<AssetSearchResult> {
    const normalizedInput = typeof input === "string" ? { query: input } : input;
    const normalizedQuery = normalizedInput.query.trim();
    const exchange = findMarketExchange(normalizedInput.exchangeCode);
    if (normalizedQuery.length < 1) {
      throw new ApplicationError(
        "invalid",
        "market_data.invalid_query",
        "Search query is required"
      );
    }

    const startedAt = this.now().getTime();
    try {
      const candidates = (
        await Promise.all(this.searchQueries(normalizedQuery, exchange).map((query) =>
          this.provider.searchAssets(query)
        ))
      ).flat();
      const assets = (await this.repository.upsertAssets(dedupeAssets(candidates))).filter(
        (asset) => assetMatchesExchange(asset, exchange)
      );
      const assetsWithQuotes = await this.attachLatestQuotes(assets);
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

      return { assets: assetsWithQuotes, providerStatus: "available", exchange };
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

      const fallbackAssets = (await this.repository.searchAssets(normalizedQuery)).filter(
        (asset) => assetMatchesExchange(asset, exchange)
      );
      if (fallbackAssets.length > 0) {
        return {
          assets: await this.attachStoredQuotes(fallbackAssets),
          providerStatus: "degraded",
          exchange
        };
      }

      throw new ApplicationError(
        "unavailable",
        "market_data.provider_unavailable",
        "Market data provider unavailable"
      );
    }
  }

  private searchQueries(query: string, exchange?: MarketExchange): string[] {
    return Array.from(new Set([query, symbolForExchangeQuery(query, exchange)]));
  }

  private async attachLatestQuotes(assets: MarketAsset[]): Promise<MarketAssetSearchItem[]> {
    return Promise.all(
      assets.map(async (asset) => {
        const latestQuote = await this.resolveLatestQuote(asset);
        return latestQuote ? { ...asset, latestQuote } : asset;
      })
    );
  }

  private async attachStoredQuotes(assets: MarketAsset[]): Promise<MarketAssetSearchItem[]> {
    return Promise.all(
      assets.map(async (asset) => {
        const latestQuote = await this.repository.findLatestQuote(asset.id);
        return latestQuote ? { ...asset, latestQuote } : asset;
      })
    );
  }

  private async resolveLatestQuote(asset: MarketAsset): Promise<LatestQuote | undefined> {
    const providerQuote = await this.provider
      .getLatestQuote(asset.providerSymbol)
      .catch(() => undefined);

    if (!providerQuote) {
      return this.repository.findLatestQuote(asset.id);
    }

    return this.repository.upsertLatestQuote({
      ...providerQuote,
      assetId: asset.id,
      symbol: asset.symbol,
      updatedAt: this.now()
    });
  }
}

export class ListMarketExchangesUseCase {
  async execute(): Promise<MarketExchange[]> {
    return MARKET_EXCHANGES;
  }
}

export class GetTradePriceUseCase {
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly repository: MarketDataRepository,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    input: { assetId: string; tradeDate: string; quantity: number },
    correlationId: string = randomUUID()
  ): Promise<TradePriceQuote> {
    const tradeDate = parseDateOnly(input.tradeDate);
    if (!tradeDate || input.quantity <= 0 || !Number.isFinite(input.quantity)) {
      throw new ApplicationError(
        "invalid",
        "market_data.invalid_trade_price_request",
        "Valid assetId, tradeDate and quantity are required"
      );
    }

    const asset = await this.repository.findAssetById(input.assetId);
    if (!asset) {
      throw new ApplicationError("not_found", "market_data.asset_not_found", "Asset not found");
    }

    const useLatestQuote = tradeDate >= this.today();
    const startedAt = this.now().getTime();

    try {
      const price = useLatestQuote
        ? await this.resolveLatestTradePrice(asset)
        : await this.resolveHistoricalTradePrice(asset, tradeDate);

      await this.repository.recordProviderRequest({
        id: randomUUID(),
        providerName: price.providerName,
        operation: price.priceSource === "latest_quote" ? "latest_quote" : "historical_prices",
        symbol: asset.providerSymbol,
        status: "succeeded",
        latencyMs: this.now().getTime() - startedAt,
        correlationId,
        requestedAt: this.now()
      });
      this.metrics.increment("market_data.provider.trade_price.success");

      return {
        ...price,
        tradeDate,
        quantity: input.quantity,
        totalAmount: roundMoney(price.unitPrice * input.quantity)
      };
    } catch (error) {
      await this.repository.recordProviderRequest({
        id: randomUUID(),
        providerName: this.provider.name,
        operation: useLatestQuote ? "latest_quote" : "historical_prices",
        symbol: asset.providerSymbol,
        status: "failed",
        latencyMs: this.now().getTime() - startedAt,
        correlationId,
        errorCode: providerErrorCode(error),
        message: error instanceof Error ? error.message : undefined,
        requestedAt: this.now()
      });
      this.metrics.increment("market_data.provider.trade_price.failure");

      throw new ApplicationError(
        "unavailable",
        "market_data.trade_price_unavailable",
        "Trade price unavailable for the selected asset and date"
      );
    }
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private async resolveLatestTradePrice(
    asset: MarketAsset
  ): Promise<Omit<TradePriceQuote, "tradeDate" | "quantity" | "totalAmount">> {
    const quote = await this.provider.getLatestQuote(asset.providerSymbol);
    const normalizedQuote = await this.repository.upsertLatestQuote({
      ...quote,
      assetId: asset.id,
      symbol: asset.symbol,
      updatedAt: this.now()
    });

    return {
      assetId: asset.id,
      symbol: asset.symbol,
      unitPrice: normalizedQuote.price,
      currency: normalizedQuote.currency,
      providerName: normalizedQuote.providerName,
      priceSource: "latest_quote",
      asOf: normalizedQuote.asOf
    };
  }

  private async resolveHistoricalTradePrice(
    asset: MarketAsset,
    tradeDate: string
  ): Promise<Omit<TradePriceQuote, "tradeDate" | "quantity" | "totalAmount">> {
    const range = { from: shiftDate(tradeDate, -7), to: tradeDate };
    const prices = await this.provider.getHistoricalPrices(asset.providerSymbol, range);
    const normalizedPrices = prices.map((price) => ({
      ...price,
      assetId: asset.id,
      symbol: asset.symbol,
      updatedAt: this.now()
    }));
    await this.repository.upsertHistoricalPrices(normalizedPrices);

    const selectedPrice = latestPriceOnOrBefore(normalizedPrices, tradeDate);
    if (!selectedPrice) {
      throw new ApplicationError(
        "unavailable",
        "market_data.trade_price_not_found",
        "No close price was found for the selected date"
      );
    }

    return {
      assetId: asset.id,
      symbol: asset.symbol,
      unitPrice: selectedPrice.close,
      currency: selectedPrice.currency,
      providerName: selectedPrice.providerName,
      priceSource: "historical_close",
      asOf: new Date(`${selectedPrice.date}T00:00:00.000Z`)
    };
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

export class ConvertCurrencyUseCase {
  constructor(
    private readonly provider: CurrencyRateProvider,
    private readonly repository: MarketDataRepository,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    input: { from: string; to: string; amount: number },
    correlationId: string = randomUUID()
  ): Promise<ExchangeRate & { amount: number; convertedAmount: number }> {
    const from = input.from.trim().toUpperCase();
    const to = input.to.trim().toUpperCase();
    const startedAt = this.now().getTime();

    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || input.amount <= 0) {
      throw new ApplicationError(
        "invalid",
        "market_data.invalid_currency_conversion",
        "Valid from, to and amount are required"
      );
    }

    try {
      const rate = await this.provider.getExchangeRate(from, to);
      await this.repository.recordProviderRequest({
        id: randomUUID(),
        providerName: rate.providerName,
        operation: "currency_rate",
        symbol: `${from}/${to}`,
        status: "succeeded",
        latencyMs: this.now().getTime() - startedAt,
        correlationId,
        requestedAt: this.now()
      });
      this.metrics.increment("market_data.provider.currency_rate.success");

      return {
        ...rate,
        amount: input.amount,
        convertedAmount: Number((input.amount * rate.rate).toFixed(8))
      };
    } catch (error) {
      await this.repository.recordProviderRequest({
        id: randomUUID(),
        providerName: this.provider.name,
        operation: "currency_rate",
        symbol: `${from}/${to}`,
        status: "failed",
        latencyMs: this.now().getTime() - startedAt,
        correlationId,
        errorCode: providerErrorCode(error),
        message: error instanceof Error ? error.message : undefined,
        requestedAt: this.now()
      });
      this.metrics.increment("market_data.provider.currency_rate.failure");

      throw new ApplicationError(
        "unavailable",
        "market_data.currency_rate_unavailable",
        "Currency conversion provider unavailable"
      );
    }
  }
}

function providerErrorCode(error: unknown): string {
  if (error instanceof ApplicationError) {
    return error.code;
  }

  return "market_data.provider_error";
}

function dedupeAssets(assets: MarketAssetCandidate[]): MarketAssetCandidate[] {
  const bySymbol = new Map<string, MarketAssetCandidate>();

  for (const asset of assets) {
    bySymbol.set(asset.symbol.toUpperCase(), asset);
  }

  return Array.from(bySymbol.values());
}

function parseDateOnly(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }

  return value;
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function latestPriceOnOrBefore(
  prices: HistoricalPrice[],
  date: string
): HistoricalPrice | undefined {
  return [...prices]
    .filter((price) => price.date <= date)
    .sort((left, right) => right.date.localeCompare(left.date))[0];
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}
