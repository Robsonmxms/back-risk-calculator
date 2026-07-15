import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { DateRange } from "../../src/modules/market-data/types";
import { BrapiMarketDataProvider } from "../../src/04-infra/providers/market-data/BrapiMarketDataProvider";
import { createSeededIdentityStore } from "../../src/04-infra/repositories/InMemoryIdentityStore";

async function login(app: Parameters<typeof request>[0], email = "user@example.com") {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });

  return response.body.data.accessToken as string;
}

class CountingProvider extends BrapiMarketDataProvider {
  latestQuoteCalls = 0;
  historicalPriceCalls = 0;
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
      providerName: "brapi"
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
    expect(provider.latestQuoteCalls).toBe(0);
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

    const queued = await marketData.scheduler.refreshTrackedAssetsAfterMarketClose(
      "scheduler-correlation"
    );
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
    const adminToken = await login(app, "admin@example.com");

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
