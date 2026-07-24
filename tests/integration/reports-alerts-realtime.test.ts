import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSeededTestApp as createApp } from "../helpers/testApp";
import { ApplicationError } from "../../src/02-application/errors/application-error";
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
import { ReportStorage } from "../../src/modules/reports-alerts/ports";
import { StoredReportFile } from "../../src/modules/reports-alerts/types";

async function login(app: Parameters<typeof request>[0], email = "user@example.com") {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });

  return response.body.data.accessToken as string;
}

describe("reports, alerts, notifications, and realtime", () => {
  it("generates reports asynchronously and authorizes downloads at request time", async () => {
    const { app, reportsAlerts } = await createApp();
    const token = await login(app);

    const requestResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/reports")
      .set("Authorization", `Bearer ${token}`)
      .send({ format: "csv" });

    expect(requestResponse.status).toBe(202);
    expect(requestResponse.body.data.status).toBe("pending");

    const pendingResponse = await request(app)
      .get("/api/v1/portfolios/prt_main/reports")
      .set("Authorization", `Bearer ${token}`);
    expect(pendingResponse.body.data.reports).toEqual([
      expect.objectContaining({ status: "pending", format: "csv" })
    ]);

    await reportsAlerts.reportWorker.processNext();

    const readyResponse = await request(app)
      .get("/api/v1/portfolios/prt_main/reports")
      .set("Authorization", `Bearer ${token}`);
    const [report] = readyResponse.body.data.reports;
    expect(report).toEqual(
      expect.objectContaining({
        status: "ready",
        fileKey: expect.stringContaining("reports/prt_main/")
      })
    );

    const downloadResponse = await request(app)
      .get(`/api/v1/reports/${report.id}/download`)
      .set("Authorization", `Bearer ${token}`);
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.header["x-report-file-key"]).toBe(report.fileKey);
    expect(downloadResponse.text).toContain("symbol,name,quantity");

    const otherToken = await login(app, "other@example.com");
    const forbiddenResponse = await request(app)
      .get(`/api/v1/reports/${report.id}/download`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbiddenResponse.status).toBe(403);
  });

  it("records failed report generation with observable metadata", async () => {
    const { app, reportsAlerts } = await createApp({
      reportsAlerts: { reportStorage: new FailingReportStorage() }
    });
    const token = await login(app);

    await request(app)
      .post("/api/v1/portfolios/prt_main/reports")
      .set("Authorization", `Bearer ${token}`)
      .send({ format: "pdf" });
    await reportsAlerts.reportWorker.processNext();

    const reportsResponse = await request(app)
      .get("/api/v1/portfolios/prt_main/reports")
      .set("Authorization", `Bearer ${token}`);
    expect(reportsResponse.body.data.reports[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        failureCode: "report.storage_unavailable"
      })
    );

    const notificationsResponse = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${token}`);
    expect(notificationsResponse.body.data.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Falha ao gerar relatório",
          sourceType: "report"
        })
      ])
    );
  });

  it("evaluates alerts after analytics updates and exposes notifications", async () => {
    const provider = new ReportsFixtureProvider();
    const { app, analytics } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider }
    });
    const token = await login(app);

    const alertResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/alerts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Analytics atualizou métricas monitoradas",
        severity: "medium",
        condition: { eventType: "analytics.updated" }
      });
    expect(alertResponse.status).toBe(201);

    await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${token}`);
    await analytics.worker.processNext();

    const notificationsResponse = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${token}`);
    expect(notificationsResponse.status).toBe(200);
    expect(notificationsResponse.body.data.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Analytics atualizou métricas monitoradas",
          sourceType: "alert",
          status: "unread"
        })
      ])
    );

    const alertsResponse = await request(app)
      .get("/api/v1/portfolios/prt_main/alerts")
      .set("Authorization", `Bearer ${token}`);
    expect(alertsResponse.body.data.alerts[0]).toEqual(
      expect.objectContaining({
        status: "open",
        lastTriggeredAt: expect.any(String)
      })
    );
  });

  it("denies notification read access for actors without portfolio visibility", async () => {
    const provider = new ReportsFixtureProvider();
    const { app, analytics } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider }
    });
    const token = await login(app);
    const otherToken = await login(app, "other@example.com");

    const alertResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/alerts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Analytics protegido",
        severity: "medium",
        condition: { eventType: "analytics.updated" }
      });

    await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${token}`);
    await analytics.worker.processNext();

    const notificationsResponse = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${token}`);
    const notification = notificationsResponse.body.data.notifications.find(
      (entry: { sourceId: string }) => entry.sourceId === alertResponse.body.data.id
    );

    const forbiddenResponse = await request(app)
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbiddenResponse.status).toBe(404);
    expect(forbiddenResponse.body.error.code).toBe("notification.not_found");
    expect(forbiddenResponse.body.data).toBeUndefined();

    const afterDeniedResponse = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${token}`);
    expect(afterDeniedResponse.body.data.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: notification.id,
          status: "unread"
        })
      ])
    );
  });

  it("keeps shared alert notification read state isolated per actor", async () => {
    const provider = new ReportsFixtureProvider();
    const { app, analytics } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider }
    });
    const token = await login(app);
    const analystToken = await login(app, "analyst@example.com");

    const alertResponse = await request(app)
      .post("/api/v1/portfolios/prt_main/alerts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Analytics compartilhado",
        severity: "medium",
        condition: { eventType: "analytics.updated" }
      });

    await request(app)
      .post("/api/v1/portfolios/prt_main/analytics/recompute")
      .set("Authorization", `Bearer ${token}`);
    await analytics.worker.processNext();

    const notificationsResponse = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${token}`);
    const notification = notificationsResponse.body.data.notifications.find(
      (entry: { sourceId: string }) => entry.sourceId === alertResponse.body.data.id
    );

    const readResponse = await request(app)
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set("Authorization", `Bearer ${token}`);
    expect(readResponse.status).toBe(200);
    expect(readResponse.body.data.status).toBe("read");

    const userNotificationsResponse = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${token}`);
    expect(userNotificationsResponse.body.data.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: notification.id,
          status: "read",
          readAt: expect.any(String)
        })
      ])
    );

    const analystNotificationsResponse = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${analystToken}`);
    expect(analystNotificationsResponse.body.data.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: notification.id,
          status: "unread"
        })
      ])
    );
  });

  it("evaluates alerts after market-data updates for affected portfolios", async () => {
    const provider = new ReportsFixtureProvider();
    const { app, marketData } = await createApp({
      marketData: { marketDataProvider: provider, currencyRateProvider: provider }
    });
    const token = await login(app);

    await request(app)
      .get("/api/v1/market-data/assets/search?q=MSFT")
      .set("Authorization", `Bearer ${token}`);
    await request(app)
      .post("/api/v1/portfolios/prt_main/alerts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Market data atualizou ativo monitorado",
        severity: "low",
        condition: { eventType: "market_data.updated" }
      });
    await request(app)
      .post("/api/v1/market-data/assets/asset-msft/refresh")
      .set("Authorization", `Bearer ${token}`);
    await marketData.worker.processNext();

    const notificationsResponse = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${token}`);

    expect(notificationsResponse.body.data.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Market data atualizou ativo monitorado",
          sourceType: "alert"
        })
      ])
    );
  });

  it("authorizes realtime subscriptions and scopes them to visible portfolios", async () => {
    const { app } = await createApp();
    const token = await login(app);

    const connectedResponse = await request(app)
      .get("/api/v1/realtime?portfolioId=prt_main&once=true")
      .set("Authorization", `Bearer ${token}`);
    expect(connectedResponse.status).toBe(200);
    expect(connectedResponse.text).toContain("event: connected");

    const anonymousResponse = await request(app).get(
      "/api/v1/realtime?portfolioId=prt_main&once=true"
    );
    expect(anonymousResponse.status).toBe(401);

    const otherToken = await login(app, "other@example.com");
    const forbiddenResponse = await request(app)
      .get("/api/v1/realtime?portfolioId=prt_main&once=true")
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbiddenResponse.status).toBe(403);

    const unscopedResponse = await request(app)
      .get("/api/v1/realtime?once=true")
      .set("Authorization", `Bearer ${token}`);
    expect(unscopedResponse.status).toBe(403);
    expect(unscopedResponse.body.error.code).toBe("realtime.portfolio_scope_required");
  });
});

class ReportsFixtureProvider implements MarketDataProvider, CurrencyRateProvider {
  readonly name = "reports-fixture";

  private readonly prices: Record<string, number> = {
    MSFT: 430,
    VTI: 245,
    NVDA: 850,
    SPY: 520
  };

  async searchAssets(query: string): Promise<MarketAssetCandidate[]> {
    return Object.keys(this.prices)
      .filter((symbol) => symbol.includes(query.trim().toUpperCase()))
      .map((symbol) => asset(symbol));
  }

  async getLatestQuote(symbol: string): Promise<LatestQuote> {
    const normalized = symbol.trim().toUpperCase();
    const price = this.prices[normalized];
    if (!price) {
      throw new ApplicationError(
        "unavailable",
        "market_data.symbol_not_supported",
        "Symbol not supported"
      );
    }

    return {
      assetId: `asset-${normalized.toLowerCase()}`,
      symbol: normalized,
      providerName: this.name,
      currency: "USD",
      price,
      asOf: new Date("2026-07-15T12:00:00.000Z"),
      freshness: "fresh",
      updatedAt: new Date("2026-07-15T12:00:00.000Z")
    };
  }

  async getHistoricalPrices(symbol: string, _range: DateRange): Promise<HistoricalPrice[]> {
    const normalized = symbol.trim().toUpperCase();
    const base = this.prices[normalized];
    if (!base) {
      throw new ApplicationError(
        "unavailable",
        "market_data.symbol_not_supported",
        "Symbol not supported"
      );
    }

    return [0.94, 0.98, 0.96, 1.02, 1].map((multiplier, index) => {
      const close = Number((base * multiplier).toFixed(2));
      const date = new Date("2026-07-10T00:00:00.000Z");
      date.setUTCDate(date.getUTCDate() + index);
      return {
        assetId: `asset-${normalized.toLowerCase()}`,
        symbol: normalized,
        providerName: this.name,
        date: date.toISOString().slice(0, 10),
        open: close,
        high: Number((close * 1.01).toFixed(2)),
        low: Number((close * 0.99).toFixed(2)),
        close,
        adjustedClose: close,
        volume: 1000000,
        currency: "USD",
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

class FailingReportStorage implements ReportStorage {
  async put(_file: StoredReportFile): Promise<StoredReportFile> {
    throw new Error("report.storage_unavailable");
  }

  async get(_fileKey: string): Promise<StoredReportFile | undefined> {
    return undefined;
  }
}

function asset(symbol: string): MarketAssetCandidate {
  return {
    id: `asset-${symbol.toLowerCase()}`,
    symbol,
    providerSymbol: symbol,
    name: `${symbol} Corp`,
    exchange: symbol === "SPY" || symbol === "VTI" ? "NYSEARCA" : "NASDAQ",
    currency: "USD",
    assetType: symbol === "SPY" || symbol === "VTI" ? "etf" : "stock",
    region: "US",
    sector: symbol === "SPY" || symbol === "VTI" ? "ETF" : "Technology",
    providerName: "reports-fixture",
    isActive: true,
    updatedAt: new Date("2026-07-15T12:00:00.000Z")
  };
}
