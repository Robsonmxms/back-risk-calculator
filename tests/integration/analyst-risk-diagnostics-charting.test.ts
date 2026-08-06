import request from "supertest";
import type { Response } from "supertest";
import { describe, expect, it } from "vitest";
import { createSeededTestApp as createApp } from "../helpers/testApp";
import { ApplicationError } from "../../src/02-application/errors/application-error";
import { CurrencyRateProvider, MarketDataProvider } from "../../src/modules/market-data/ports";
import {
  DateRange,
  Dividend,
  ExchangeRate,
  HistoricalPrice,
  LatestQuote,
  MarketAssetCandidate,
  Split
} from "../../src/modules/market-data/types";

async function login(app: Parameters<typeof request>[0], email: string) {
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

class DiagnosticsFixtureProvider implements MarketDataProvider, CurrencyRateProvider {
  readonly name = "diagnostics-fixture";

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

  async getHistoricalPrices(symbol: string, _range: DateRange): Promise<HistoricalPrice[]> {
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

    return [0.91, 0.94, 0.98, 0.96, 1.01, 1].map((multiplier, index) => {
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
    return {
      from: from.trim().toUpperCase(),
      to: to.trim().toUpperCase(),
      rate: 1,
      providerName: this.name,
      asOf: new Date("2026-07-15T12:00:00.000Z"),
      updatedAt: new Date("2026-07-15T12:00:00.000Z")
    };
  }
}

describe("analyst risk diagnostics charting", () => {
  it("returns analyst diagnostic chart sections with source snapshot metadata", async () => {
    const provider = new DiagnosticsFixtureProvider();
    const { app, analytics } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider },
      analytics: { analyticsNow: () => new Date("2026-07-15T12:00:00.000Z") }
    });
    const analystToken = await login(app, "analyst@risk.local");

    await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${analystToken}`);
    await analytics.worker.processNext();

    const response = await request(app)
      .get("/api/v1/offices/ofc_main/analytics/charts")
      .query({
        range: "1y",
        metrics: "volatility,beta,sharpeRatio,maxDrawdown,concentrationHhi",
        benchmarkSymbol: "SPY"
      })
      .set("Authorization", `Bearer ${analystToken}`);

    expect(response.status).toBe(200);
    expectProtectedNoStore(response);
    expect(response.body.meta.sourceSnapshotIds).toEqual([expect.any(String)]);
    expect(response.body.meta.inputHashes).toEqual([expect.any(String)]);
    expect(response.body.data.officeId).toBe("ofc_main");
    expect(response.body.data.charts.riskReturnScatter).toEqual(
      expect.arrayContaining([expect.objectContaining({ portfolioId: "prt_main" })])
    );
    expect(response.body.data.charts.metricDistributions.length).toBeGreaterThanOrEqual(5);
    expect(response.body.data.charts.rollingVolatility.length).toBeGreaterThan(0);
    expect(response.body.data.charts.sectorExposureHeatmap.length).toBeGreaterThan(0);
    expect(response.body.data.charts.assetExposureHeatmap.length).toBeGreaterThan(0);
    expect(response.body.data.charts.benchmarkSensitivity).toEqual(
      expect.arrayContaining([expect.objectContaining({ benchmarkSymbol: "SPY" })])
    );
    expect(response.body.data.charts.providerFreshnessMatrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: "MSFT", providerName: "diagnostics-fixture" })
      ])
    );
    expect(JSON.stringify(response.body)).not.toContain("Cliente Reservado");
    expect(JSON.stringify(response.body)).not.toContain("prt_income");
  });

  it("denies non-analyst users and out-of-scope requested portfolios", async () => {
    const { app } = await createApp();
    const advisorToken = await login(app, "advisor@example.com");
    const analystToken = await login(app, "analyst@risk.local");

    const advisorResponse = await request(app)
      .get("/api/v1/offices/ofc_main/analytics/charts")
      .set("Authorization", `Bearer ${advisorToken}`);
    expect(advisorResponse.status).toBe(403);
    expect(advisorResponse.body.error.code).toBe("auth.permission_denied");
    expectProtectedNoStore(advisorResponse);

    const outOfScope = await request(app)
      .get("/api/v1/offices/ofc_main/analytics/charts")
      .query({ portfolioIds: "prt_income" })
      .set("Authorization", `Bearer ${analystToken}`);
    expect(outOfScope.status).toBe(403);
    expect(outOfScope.body.error.code).toBe("auth.analyst_chart_scope_denied");
    expectProtectedNoStore(outOfScope);
  });

  it("creates idempotent async diagnostic jobs and exposes pending status", async () => {
    const { app } = await createApp();
    const analystToken = await login(app, "analyst@risk.local");

    const missingIdempotency = await request(app)
      .post("/api/v1/offices/ofc_main/analytics/chart-jobs")
      .set("Authorization", `Bearer ${analystToken}`)
      .send({ range: "5y", portfolioIds: "prt_main" });
    expect(missingIdempotency.status).toBe(400);
    expect(missingIdempotency.body.error.code).toBe("request.idempotency_key_required");

    const outOfScopeJob = await request(app)
      .post("/api/v1/offices/ofc_main/analytics/chart-jobs")
      .set("Authorization", `Bearer ${analystToken}`)
      .set("Idempotency-Key", "diag-job-denied")
      .send({ range: "5y", portfolioIds: "prt_income" });
    expect(outOfScopeJob.status).toBe(403);
    expect(outOfScopeJob.body.error.code).toBe("auth.analyst_chart_scope_denied");

    const createJob = await request(app)
      .post("/api/v1/offices/ofc_main/analytics/chart-jobs")
      .set("Authorization", `Bearer ${analystToken}`)
      .set("Idempotency-Key", "diag-job-001")
      .send({ range: "5y", portfolioIds: "prt_main", benchmarkSymbol: "SPY" });
    expect(createJob.status).toBe(202);
    expectProtectedNoStore(createJob);
    expect(createJob.body.data).toMatchObject({
      officeId: "ofc_main",
      status: "pending",
      progressPercent: 0
    });

    const replay = await request(app)
      .post("/api/v1/offices/ofc_main/analytics/chart-jobs")
      .set("Authorization", `Bearer ${analystToken}`)
      .set("Idempotency-Key", "diag-job-001")
      .send({ range: "5y", portfolioIds: "prt_main", benchmarkSymbol: "SPY" });
    expect(replay.status).toBe(202);
    expect(replay.body.data.id).toBe(createJob.body.data.id);

    const getJob = await request(app)
      .get(`/api/v1/offices/ofc_main/analytics/chart-jobs/${createJob.body.data.id}`)
      .set("Authorization", `Bearer ${analystToken}`);
    expect(getJob.status).toBe(200);
    expect(getJob.body.data.status).toBe("pending");
    expect(getJob.body.meta.inputHash).toEqual(expect.any(String));
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
    providerName: "diagnostics-fixture",
    isActive: true,
    updatedAt: new Date("2026-07-15T12:00:00.000Z")
  };
}
