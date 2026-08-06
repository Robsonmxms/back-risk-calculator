import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSeededTestApp as createApp } from "../helpers/testApp";
import type { CurrencyRateProvider } from "../../src/modules/market-data/ports";
import type { DateRange } from "../../src/modules/market-data/types";
import { BrapiMarketDataProvider } from "../helpers/BrapiMarketDataProvider";
import { createSeededIdentityStore } from "../helpers/seededIdentityStore";

async function login(app: Parameters<typeof request>[0], email = "user@risk.local") {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });

  return response.body.data.accessToken as string;
}

class CountingProvider extends BrapiMarketDataProvider {
  latestQuoteCalls = 0;
  historicalPriceCalls = 0;
  currencyRateCalls = 0;
  shouldFailLatestQuote = false;

  async getLatestQuote(symbol: string) {
    this.latestQuoteCalls += 1;
    if (this.shouldFailLatestQuote) {
      throw new Error("market_data.provider_rate_limited");
    }

    return super.getLatestQuote(symbol);
  }

  async getHistoricalPrices(symbol: string, range: DateRange) {
    this.historicalPriceCalls += 1;
    return super.getHistoricalPrices(symbol, range);
  }

  async getExchangeRate(from: string, to: string) {
    this.currencyRateCalls += 1;
    return super.getExchangeRate(from, to);
  }
}

class FallbackCurrencyProvider implements CurrencyRateProvider {
  readonly name = "yahoo";

  async getExchangeRate(from: string, to: string) {
    return {
      from,
      to,
      rate: 5.25,
      providerName: "open.er-api",
      asOf: new Date("2026-07-15T11:00:00.000Z"),
      updatedAt: new Date("2026-07-15T12:00:00.000Z")
    };
  }
}

describe("market data ingestion", () => {
  it("searches normalized assets and queues refresh work asynchronously", async () => {
    const provider = new CountingProvider();
    const { app, marketData } = await createApp({
      marketData: { marketDataProvider: provider }
    });
    const token = await login(app);

    const searchResponse = await request(app)
      .get("/api/v1/market-data/assets/search?q=MSFT")
      .set("Authorization", `Bearer ${token}`);

    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body.meta).toMatchObject({
      count: 1,
      providerStatus: "available"
    });
    expect(searchResponse.body.data.assets[0]).toMatchObject({
      id: "asset-msft",
      symbol: "MSFT",
      name: "Microsoft Corporation",
      currency: "USD",
      providerName: "brapi",
      latestQuote: expect.objectContaining({
        price: 420.44,
        currency: "USD"
      })
    });

    const refreshResponse = await request(app)
      .post("/api/v1/market-data/assets/asset-msft/refresh")
      .set("Authorization", `Bearer ${token}`);

    expect(refreshResponse.status).toBe(202);
    expect(refreshResponse.body.data).toMatchObject({
      status: "queued",
      assetId: "asset-msft",
      symbol: "MSFT"
    });
    await expect(marketData.queue.listJobs()).resolves.toHaveLength(1);
    expect(provider.latestQuoteCalls).toBe(1);
  });

  it("lists supported exchanges and filters search results by exchange", async () => {
    const provider = new CountingProvider();
    const { app } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider }
    });
    const token = await login(app);

    const exchangesResponse = await request(app)
      .get("/api/v1/market-data/exchanges")
      .set("Authorization", `Bearer ${token}`);
    expect(exchangesResponse.status).toBe(200);
    expect(exchangesResponse.body.data.exchanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "B3",
          yahooSuffix: ".SA",
          currency: "BRL"
        }),
        expect.objectContaining({
          code: "NASDAQ",
          currency: "USD"
        })
      ])
    );

    const b3SearchResponse = await request(app)
      .get("/api/v1/market-data/assets/search?q=PETR&exchange=B3")
      .set("Authorization", `Bearer ${token}`);

    expect(b3SearchResponse.status).toBe(200);
    expect(b3SearchResponse.body.meta.exchange).toBe("B3");
    expect(b3SearchResponse.body.data.assets).toEqual([
      expect.objectContaining({
        symbol: "PETR4",
        exchange: "B3",
        currency: "BRL",
        latestQuote: expect.objectContaining({
          price: 38.16,
          currency: "BRL"
        })
      })
    ]);
  });

  it("validates FX conversion amounts before calling providers", async () => {
    const provider = new CountingProvider();
    const { app, marketData } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider }
    });
    const token = await login(app);

    const validResponse = await request(app)
      .get("/api/v1/market-data/fx-rate?from=USD&to=BRL&amount=2.5")
      .set("Authorization", `Bearer ${token}`);
    expect(validResponse.status).toBe(200);
    expect(validResponse.body.data.conversion).toEqual(
      expect.objectContaining({
        from: "USD",
        to: "BRL",
        amount: 2.5,
        convertedAmount: expect.any(Number),
        freshness: "fresh",
        sourceAgeSeconds: expect.any(Number),
        sourceType: "live"
      })
    );

    const defaultAmountResponse = await request(app)
      .get("/api/v1/market-data/fx-rate?from=USD&to=BRL")
      .set("Authorization", `Bearer ${token}`);
    expect(defaultAmountResponse.status).toBe(200);
    expect(defaultAmountResponse.body.data.conversion.amount).toBe(1);

    for (const amount of ["abc", "NaN", "Infinity", "0", "-1"]) {
      const invalidResponse = await request(app)
        .get(`/api/v1/market-data/fx-rate?from=USD&to=BRL&amount=${amount}`)
        .set("Authorization", `Bearer ${token}`);
      expect(invalidResponse.status).toBe(400);
      expect(invalidResponse.body.error.code).toBe("market_data.invalid_currency_conversion");
    }

    expect(provider.currencyRateCalls).toBe(2);
    const currencyRequests = (await marketData.repository.listProviderRequests()).filter(
      (entry) => entry.operation === "currency_rate"
    );
    expect(currencyRequests).toHaveLength(2);
    expect(currencyRequests).toEqual([
      expect.objectContaining({ status: "succeeded" }),
      expect.objectContaining({ status: "succeeded" })
    ]);
  });

  it("exposes fallback source and source age without relabeling it as the configured provider", async () => {
    const now = () => new Date("2026-07-15T12:00:00.000Z");
    const provider = new CountingProvider(now);
    const { app, metrics } = await createApp({
      marketData: {
        marketDataProvider: provider,
        currencyRateProvider: new FallbackCurrencyProvider(),
        marketDataNow: now
      }
    });
    const token = await login(app);

    const response = await request(app)
      .get("/api/v1/market-data/fx-rate?from=USD&to=BRL&amount=2")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.conversion).toMatchObject({
      providerName: "open.er-api",
      asOf: "2026-07-15T11:00:00.000Z",
      updatedAt: "2026-07-15T12:00:00.000Z",
      sourceType: "fallback",
      freshness: "partial",
      sourceAgeSeconds: 3600
    });
    expect(metrics.snapshot()["market_data.currency_rate.fallback"]).toBe(1);
  });

  it("calculates transaction trade price from provider data", async () => {
    const now = () => new Date("2026-07-15T12:00:00.000Z");
    const provider = new CountingProvider(now);
    const { app } = await createApp({
      marketData: { marketDataProvider: provider, marketDataNow: now }
    });
    const token = await login(app);

    await request(app)
      .get("/api/v1/market-data/assets/search?q=MSFT")
      .set("Authorization", `Bearer ${token}`);

    const latestPriceResponse = await request(app)
      .get("/api/v1/market-data/assets/asset-msft/trade-price?tradeDate=2026-07-15&quantity=3")
      .set("Authorization", `Bearer ${token}`);

    expect(latestPriceResponse.status).toBe(200);
    expect(latestPriceResponse.body.data.tradePrice).toMatchObject({
      assetId: "asset-msft",
      symbol: "MSFT",
      tradeDate: "2026-07-15",
      quantity: 3,
      unitPrice: 420.44,
      totalAmount: 1261.32,
      currency: "USD",
      priceSource: "latest_quote"
    });
    expect(latestPriceResponse.body.meta).toMatchObject({
      providerName: "brapi",
      priceSource: "latest_quote"
    });

    const historicalPriceResponse = await request(app)
      .get("/api/v1/market-data/assets/asset-msft/trade-price?tradeDate=2026-07-14&quantity=2")
      .set("Authorization", `Bearer ${token}`);

    expect(historicalPriceResponse.status).toBe(200);
    expect(historicalPriceResponse.body.data.tradePrice).toMatchObject({
      unitPrice: 420.44,
      totalAmount: 840.88,
      currency: "USD",
      priceSource: "historical_close"
    });
    expect(provider.latestQuoteCalls).toBe(2);
    expect(provider.historicalPriceCalls).toBe(1);
  });

  it("uses quote and historical caches inside the TTL and keeps historical rows idempotent", async () => {
    const provider = new CountingProvider();
    const { app, marketData } = await createApp({
      marketData: { marketDataProvider: provider }
    });
    const token = await login(app);

    await request(app)
      .get("/api/v1/market-data/assets/search?q=MSFT")
      .set("Authorization", `Bearer ${token}`);

    await request(app)
      .post("/api/v1/market-data/assets/asset-msft/refresh")
      .set("Authorization", `Bearer ${token}`);
    await marketData.worker.processNext();

    await request(app)
      .post("/api/v1/market-data/assets/asset-msft/refresh")
      .set("Authorization", `Bearer ${token}`);
    await marketData.worker.processNext();

    expect(provider.latestQuoteCalls).toBe(1);
    expect(provider.historicalPriceCalls).toBe(1);
    await expect(marketData.repository.listHistoricalPrices("asset-msft")).resolves.toHaveLength(2);
  });

  it("preserves last known good data and emits failure events when the provider fails", async () => {
    let currentTime = new Date("2026-07-15T12:00:00.000Z");
    const now = () => currentTime;
    const provider = new CountingProvider(now);
    const { app, marketData, metrics } = await createApp({
      marketData: { marketDataProvider: provider, marketDataNow: now }
    });
    const token = await login(app);

    await request(app)
      .get("/api/v1/market-data/assets/search?q=MSFT")
      .set("Authorization", `Bearer ${token}`);
    await request(app)
      .post("/api/v1/market-data/assets/asset-msft/refresh")
      .set("Authorization", `Bearer ${token}`);
    await marketData.worker.processNext();
    const lastKnownQuote = await marketData.repository.findLatestQuote("asset-msft");

    currentTime = new Date(currentTime.getTime() + 31_000);
    provider.shouldFailLatestQuote = true;
    await request(app)
      .post("/api/v1/market-data/assets/asset-msft/refresh")
      .set("Authorization", `Bearer ${token}`);
    await marketData.worker.processNext();

    await expect(marketData.repository.findLatestQuote("asset-msft")).resolves.toEqual(
      lastKnownQuote
    );
    const requests = await marketData.repository.listProviderRequests();
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerName: "brapi",
          symbol: "MSFT",
          status: "failed",
          errorCode: "market_data.provider_rate_limited"
        })
      ])
    );
    expect(metrics.snapshot()["market_data.refresh.failure"]).toBe(1);
  });

  it("schedules tracked assets and emits analytics recomputation after updates", async () => {
    const provider = new CountingProvider();
    const identityStore = await createSeededIdentityStore();
    const { app, marketData } = await createApp({
      identityStore,
      marketData: { marketDataProvider: provider }
    });
    const token = await login(app);

    await request(app)
      .get("/api/v1/market-data/assets/search?q=MSFT")
      .set("Authorization", `Bearer ${token}`);

    const queued =
      await marketData.scheduler.refreshTrackedAssetsAfterMarketClose("scheduler-correlation");
    expect(queued).toEqual([
      expect.objectContaining({
        assetId: "asset-msft",
        symbol: "MSFT"
      })
    ]);

    await marketData.worker.processNext();
    const jobs = await marketData.queue.listJobs();
    expect(jobs[0].status).toBe("succeeded");
    const outbox = await identityStore.listOutboxEvents();
    expect(outbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topic: "MarketDataUpdated", aggregateId: "asset-msft" }),
        expect.objectContaining({ topic: "AnalyticsRequested", aggregateId: "prt_main" })
      ])
    );
  });

  it("exposes provider status to admins only", async () => {
    const provider = new CountingProvider();
    const { app } = await createApp({
      marketData: { marketDataProvider: provider }
    });
    const userToken = await login(app);
    const adminToken = await login(app, "admin@risk.local");

    const forbiddenResponse = await request(app)
      .get("/api/v1/market-data/provider-status")
      .set("Authorization", `Bearer ${userToken}`);
    expect(forbiddenResponse.status).toBe(403);

    const adminResponse = await request(app)
      .get("/api/v1/market-data/provider-status")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body.data.provider).toMatchObject({
      providerName: "brapi",
      requestCount: 0,
      errorCount: 0
    });
  });
});
