import request from "supertest";
import type { Response } from "supertest";
import { describe, expect, it } from "vitest";
import { createSeededTestApp as createApp } from "../helpers/testApp";
import {
  CurrencyRateProvider,
  MarketDataProvider
} from "../../src/modules/market-data/ports";
import {
  DateRange,
  Dividend,
  ExchangeRate,
  HistoricalPrice,
  LatestQuote,
  MarketAssetCandidate,
  Split
} from "../../src/modules/market-data/types";

const fixedNow = () => new Date("2026-07-15T12:00:00.000Z");

async function login(app: Parameters<typeof request>[0], email = "user@risk.local") {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });

  return response.body.data.accessToken as string;
}

function expectProtectedNoStore(response: Response) {
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers.pragma).toBe("no-cache");
  expect(response.headers.expires).toBe("0");
  expect(response.headers.vary).toContain("Authorization");
}

class ChartFixtureProvider implements MarketDataProvider, CurrencyRateProvider {
  readonly name = "chart-fixture";

  private readonly assets: Record<string, MarketAssetCandidate> = {
    MSFT: asset("MSFT", "Microsoft Corporation", "NASDAQ", "USD", "Technology"),
    NVDA: asset("NVDA", "NVIDIA Corporation", "NASDAQ", "USD", "Technology"),
    VTI: asset("VTI", "Vanguard Total Stock Market ETF", "NYSEARCA", "USD", "ETF"),
    SPY: asset("SPY", "SPDR S&P 500 ETF Trust", "NYSEARCA", "USD", "Benchmark")
  };

  private readonly latestPrices: Record<string, number> = {
    MSFT: 430,
    NVDA: 840,
    VTI: 240,
    SPY: 520
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
      throw new Error("market_data.symbol_not_supported");
    }

    return {
      assetId: assetCandidate.id,
      symbol: assetCandidate.symbol,
      providerName: this.name,
      currency: assetCandidate.currency,
      price,
      asOf: fixedNow(),
      freshness: "fresh",
      updatedAt: fixedNow()
    };
  }

  async getHistoricalPrices(symbol: string, _range: DateRange): Promise<HistoricalPrice[]> {
    const normalized = symbol.trim().toUpperCase();
    const assetCandidate = this.assets[normalized];
    const base = this.latestPrices[normalized];
    if (!assetCandidate || !base) {
      throw new Error("market_data.symbol_not_supported");
    }

    return [0.92, 0.95, 0.99, 0.97, 1.02, 1].map((multiplier, index) => {
      const close = Number((base * multiplier).toFixed(2));
      const date = new Date("2026-07-08T00:00:00.000Z");
      date.setUTCDate(date.getUTCDate() + index);

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
        updatedAt: fixedNow()
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
    return {
      from: from.trim().toUpperCase(),
      to: to.trim().toUpperCase(),
      rate: 1,
      providerName: this.name,
      asOf: fixedNow(),
      updatedAt: fixedNow()
    };
  }
}

describe("client portfolio charting", () => {
  it("returns a chart bundle from analytics snapshots and backend-owned market history", async () => {
    const provider = new ChartFixtureProvider();
    const { app, analytics } = await createApp({
      marketData: {
        marketDataProvider: provider,
        currencyRateProvider: provider,
        marketDataNow: fixedNow
      },
      analytics: { analyticsNow: fixedNow }
    });
    const token = await login(app);

    await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${token}`);
    await analytics.worker.processNext();

    const response = await request(app)
      .get("/api/v1/portfolios/prt_main/charts?range=1m&interval=daily&benchmarkSymbol=SPY")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expectProtectedNoStore(response);
    expect(response.body.meta.sourceSnapshotId).toEqual(expect.any(String));
    expect(response.body.data.dataQuality.status).toBe("partial");
    expect(response.body.data.dataQuality.unavailableChartKeys).toContain("correlation");
    expect(response.body.data.charts.assetPrices).toHaveLength(3);
    expect(response.body.data.charts.assetPrices[0]).toEqual(
      expect.objectContaining({
        providerName: "chart-fixture",
        freshness: "fresh",
        points: expect.arrayContaining([expect.objectContaining({ date: "2026-07-08" })])
      })
    );
    expect(response.body.data.charts.portfolioPerformance.length).toBeGreaterThan(1);
    expect(response.body.data.charts.cumulativeReturn.length).toBeGreaterThan(1);
    expect(response.body.data.charts.rollingRisk.length).toBeGreaterThan(0);
    expect(response.body.data.charts.correlation.symbols).toEqual(["MSFT", "NVDA", "VTI"]);
    expect(response.body.data.charts.benchmarkComparison.length).toBeGreaterThan(1);
    expect(response.body.data.charts.annotations).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "analytics" })])
    );

    const assetId = response.body.data.charts.assetPrices[0].assetId as string;
    const historyResponse = await request(app)
      .get(`/api/v1/market-data/assets/${assetId}/history?interval=weekly`)
      .set("Authorization", `Bearer ${token}`);

    expect(historyResponse.status).toBe(200);
    expectProtectedNoStore(historyResponse);
    expect(historyResponse.body.data.asset).toEqual(
      expect.not.objectContaining({ providerSymbol: expect.any(String) })
    );
    expect(historyResponse.body.data.history.length).toBeGreaterThan(0);
    expect(historyResponse.body.data.dataQuality.status).toBe("complete");
  });

  it("returns pending chart quality when analytics and market history are not available yet", async () => {
    const { app } = await createApp();
    const token = await login(app);

    const response = await request(app)
      .get("/api/v1/portfolios/prt_main/charts?assetSymbols=MSFT,UNKNOWN")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.dataQuality.status).toBe("pending");
    expect(response.body.data.dataQuality.unavailableChartKeys).toEqual(
      expect.arrayContaining(["assetPrices", "rollingRisk"])
    );
    expect(response.body.data.dataQuality.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "charts.asset_not_in_portfolio" }),
        expect.objectContaining({ code: "charts.asset_history_unavailable" })
      ])
    );
  });

  it("uses the same stable authorization error for missing and out-of-scope chart requests", async () => {
    const { app } = await createApp();
    const otherToken = await login(app, "other@risk.local");

    const outOfScope = await request(app)
      .get("/api/v1/portfolios/prt_main/charts")
      .set("Authorization", `Bearer ${otherToken}`);
    const missing = await request(app)
      .get("/api/v1/portfolios/prt_missing/charts")
      .set("Authorization", `Bearer ${otherToken}`);

    expect(outOfScope.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(outOfScope.body.error.code).toBe("auth.portfolio_chart_access_denied");
    expect(missing.body.error.code).toBe("auth.portfolio_chart_access_denied");
    expectProtectedNoStore(outOfScope);
    expectProtectedNoStore(missing);
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
    id: `asset-${symbol.toLowerCase()}`,
    symbol,
    providerSymbol: symbol,
    name,
    exchange,
    currency,
    assetType: "stock",
    region: "US",
    sector,
    providerName: "chart-fixture",
    isActive: true,
    updatedAt: fixedNow()
  };
}
