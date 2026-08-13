import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSeededTestApp as createApp } from "../helpers/testApp";
import { ApplicationError } from "../../src/02-application/errors/application-error";
import { InMemoryAnalyticsStore } from "../../src/04-infra/repositories/InMemoryAnalyticsStore";
import {
  CurrencyRateProvider,
  MarketDataProvider
} from "../../src/02-application/market-data/ports";
import {
  DateRange,
  Dividend,
  ExchangeRate,
  HistoricalPrice,
  LatestQuote,
  MarketAssetCandidate,
  Split
} from "../../src/01-domain/market-data/types";

async function login(app: Parameters<typeof request>[0], email = "user@risk.local") {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });

  return response.body.data.accessToken as string;
}

class AnalyticsFixtureProvider implements MarketDataProvider, CurrencyRateProvider {
  readonly name = "analytics-fixture";
  missingHistory = false;
  historyPointCount = 31;

  private readonly assets: Record<string, MarketAssetCandidate> = {
    MSFT: asset("MSFT", "Microsoft Corporation", "NASDAQ", "USD", "Technology"),
    NVDA: asset("NVDA", "NVIDIA Corporation", "NASDAQ", "USD", "Technology"),
    VTI: asset("VTI", "Vanguard Total Stock Market ETF", "NYSEARCA", "USD", "ETF"),
    SPY: asset("SPY", "SPDR S&P 500 ETF Trust", "NYSEARCA", "USD", "Benchmark"),
    "PETR4.SA": asset("PETR4.SA", "Petrobras PN", "B3", "BRL", "Energy")
  };

  private readonly latestPrices: Record<string, number> = {
    MSFT: 430,
    NVDA: 840,
    VTI: 240,
    SPY: 520,
    "PETR4.SA": 38
  };

  async searchAssets(query: string): Promise<MarketAssetCandidate[]> {
    const normalized = query.trim().toUpperCase();
    return Object.values(this.assets).filter((entry) => entry.symbol.includes(normalized));
  }

  async getLatestQuote(symbol: string): Promise<LatestQuote> {
    const normalized = symbol.trim().toUpperCase();
    const assetCandidate = this.assets[normalized];
    const price = this.latestPrices[normalized];
    if (!assetCandidate || !price) {
      throw new ApplicationError(
        "unavailable",
        "market_data.symbol_not_supported",
        "Symbol not supported"
      );
    }

    return {
      assetId: assetCandidate.id,
      symbol: assetCandidate.symbol,
      providerName: this.name,
      currency: assetCandidate.currency,
      price,
      asOf: new Date("2026-07-15T12:00:00.000Z"),
      freshness: "fresh",
      updatedAt: new Date("2026-07-15T12:00:00.000Z")
    };
  }

  async getHistoricalPrices(symbol: string, range: DateRange): Promise<HistoricalPrice[]> {
    if (this.missingHistory) {
      throw new ApplicationError(
        "unavailable",
        "market_data.historical_prices_unavailable",
        "History unavailable"
      );
    }

    const normalized = symbol.trim().toUpperCase();
    const assetCandidate = this.assets[normalized];
    const base = this.latestPrices[normalized];
    if (!assetCandidate || !base) {
      throw new ApplicationError(
        "unavailable",
        "market_data.symbol_not_supported",
        "Symbol not supported"
      );
    }

    const endDate = new Date(`${range.to}T00:00:00.000Z`);
    return Array.from({ length: this.historyPointCount }, (_, index) => {
      const progress = index / Math.max(1, this.historyPointCount - 1);
      const multiplier = 0.9 + progress * 0.1 + Math.sin(index / 3) * 0.005;
      const close = Number((base * multiplier).toFixed(2));
      const date = new Date(endDate);
      date.setUTCDate(endDate.getUTCDate() - (this.historyPointCount - 1 - index));

      return {
        assetId: assetCandidate.id,
        symbol: assetCandidate.symbol,
        providerName: this.name,
        date: date.toISOString().slice(0, 10),
        open: close,
        high: Number((close * 1.01).toFixed(2)),
        low: Number((close * 0.99).toFixed(2)),
        close,
        adjustedClose: close,
        volume: 1_000_000,
        currency: assetCandidate.currency,
        updatedAt: new Date("2026-07-15T12:00:00.000Z")
      };
    });
  }

  async getDividends(_symbol: string, _range: DateRange): Promise<Dividend[]> {
    return [];
  }

  async getSplits(_symbol: string, _range: DateRange): Promise<Split[]> {
    return [];
  }

  async getExchangeRate(from: string, to: string): Promise<ExchangeRate> {
    const normalizedFrom = from.trim().toUpperCase();
    const normalizedTo = to.trim().toUpperCase();
    const rates: Record<string, number> = {
      "USD/USD": 1,
      "BRL/USD": 0.2,
      "USD/BRL": 5
    };
    const rate = rates[`${normalizedFrom}/${normalizedTo}`];
    if (!rate) {
      throw new ApplicationError(
        "unavailable",
        "market_data.currency_pair_not_supported",
        "Currency not supported"
      );
    }

    return {
      from: normalizedFrom,
      to: normalizedTo,
      rate,
      providerName: this.name,
      asOf: new Date("2026-07-15T12:00:00.000Z"),
      updatedAt: new Date("2026-07-15T12:00:00.000Z")
    };
  }
}

class FlakyAnalyticsRepository extends InMemoryAnalyticsStore {
  failSaves = false;

  async saveSnapshot(snapshot: Parameters<InMemoryAnalyticsStore["saveSnapshot"]>[0]) {
    if (this.failSaves) {
      throw new Error("analytics.persistence_failed");
    }

    return super.saveSnapshot(snapshot);
  }
}

describe("analytics risk engine", () => {
  it("stores a complete analytics snapshot with risk insights and USD conversion", async () => {
    const provider = new AnalyticsFixtureProvider();
    const { app, analytics, metrics } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider }
    });
    const token = await login(app);

    const pendingResponse = await request(app)
      .get("/api/v1/portfolios/prt_main/analytics")
      .set("Authorization", `Bearer ${token}`);
    expect(pendingResponse.status).toBe(200);
    expect(pendingResponse.body.data.status).toBe("pending");

    await request(app)
      .post("/api/v1/portfolios/prt_main/transactions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        assetSymbol: "PETR4.SA",
        assetName: "Petrobras PN",
        tradeDate: "2026-07-14",
        type: "buy",
        quantity: 1000,
        unitPrice: 38,
        currency: "BRL"
      });

    const recomputeResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${token}`);
    expect(recomputeResponse.status).toBe(202);

    await analytics.worker.processNext();

    const analyticsResponse = await request(app)
      .get("/api/v1/portfolios/prt_main/analytics")
      .set("Authorization", `Bearer ${token}`);

    expect(analyticsResponse.status).toBe(200);
    expect(analyticsResponse.body.data.status).toBe("complete");
    expect(analyticsResponse.body.data.snapshot.baseCurrency).toBe("USD");
    expect(analyticsResponse.body.data.snapshot.metrics.totalReturn.status).toBe("available");
    expect(analyticsResponse.body.data.snapshot.metrics.beta.status).toBe("available");
    expect(analyticsResponse.body.data.snapshot.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetSymbol: "PETR4.SA",
          marketValueUsd: 7600
        })
      ])
    );
    expect(analyticsResponse.body.data.snapshot.dataQuality.conversionRates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "BRL",
          to: "USD",
          rate: 0.2
        })
      ])
    );
    expect(analyticsResponse.body.data.snapshot.insights).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Exposição setorial concentrada" })])
    );
    expect(metrics.snapshot()["analytics.calculation.success"]).toBe(1);
  });

  it("marks snapshots partial and gives unavailable metric reasons when historical data is missing", async () => {
    const provider = new AnalyticsFixtureProvider();
    provider.missingHistory = true;
    const { app, analytics } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider }
    });
    const token = await login(app);

    await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${token}`);
    await analytics.worker.processNext();

    const response = await request(app)
      .get("/api/v1/portfolios/prt_main/analytics")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.snapshot.status).toBe("partial");
    expect(response.body.data.snapshot.metrics.volatility).toMatchObject({
      status: "unavailable",
      reasonCode: "analytics.insufficient_sample",
      observationCount: 0,
      effectiveHorizonDays: 0,
      calculationVersion: "risk-v2-minimum-sample"
    });
    expect(response.body.data.snapshot.dataQuality.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "analytics.history_unavailable" })])
    );
  });

  it("qualifies short histories with stable sample metadata instead of annualizing them", async () => {
    const provider = new AnalyticsFixtureProvider();
    provider.historyPointCount = 30;
    const { app, analytics } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider }
    });
    const token = await login(app);

    await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${token}`);
    await analytics.worker.processNext();

    const response = await request(app)
      .get("/api/v1/portfolios/prt_main/analytics")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.snapshot.metrics.annualizedReturn).toMatchObject({
      status: "unavailable",
      reasonCode: "analytics.insufficient_sample",
      observationCount: 29,
      effectiveHorizonDays: 29,
      calculationVersion: "risk-v2-minimum-sample"
    });
    expect(response.body.data.snapshot.dataQuality.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "analytics.insufficient_sample",
          metricKeys: ["annualizedReturn"]
        })
      ])
    );
  });

  it("does not create duplicate effective snapshots when a job is replayed", async () => {
    const provider = new AnalyticsFixtureProvider();
    const { app, analytics } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider }
    });
    const token = await login(app);

    await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${token}`);
    const [job] = await analytics.repository.listJobs();
    await analytics.worker.processJob(job);
    await analytics.worker.processJob(job);

    await expect(analytics.repository.listSnapshots("prt_main")).resolves.toHaveLength(1);
  });

  it("keeps the latest successful snapshot readable after a calculation failure", async () => {
    const provider = new AnalyticsFixtureProvider();
    const repository = new FlakyAnalyticsRepository();
    const { app, analytics } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider },
      analytics: { analyticsRepository: repository }
    });
    const token = await login(app);

    await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${token}`);
    await analytics.worker.processNext();
    const [successfulSnapshot] = await analytics.repository.listSnapshots("prt_main");

    repository.failSaves = true;
    await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${token}`);
    await analytics.worker.processNext();

    const response = await request(app)
      .get("/api/v1/portfolios/prt_main/analytics")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("failed");
    expect(response.body.data.lastSuccessfulSnapshot.id).toBe(successfulSnapshot.id);
    await expect(analytics.repository.listSnapshots("prt_main")).resolves.toHaveLength(1);
  });
});

function asset(
  symbol: string,
  name: string,
  exchange: string,
  currency: string,
  sector: string
): MarketAssetCandidate {
  return {
    id: `asset-${symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    symbol,
    providerSymbol: symbol,
    name,
    exchange,
    currency,
    assetType: "stock",
    region: exchange === "B3" ? "BR" : "US",
    sector,
    providerName: "analytics-fixture",
    isActive: true,
    updatedAt: new Date("2026-07-15T12:00:00.000Z")
  };
}
