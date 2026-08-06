import { createSeededTestApp } from "../tests/helpers/testApp";
import type { CurrencyRateProvider, MarketDataProvider } from "../src/modules/market-data/ports";
import type {
  DateRange,
  Dividend,
  ExchangeRate,
  HistoricalPrice,
  LatestQuote,
  MarketAssetCandidate,
  Split
} from "../src/modules/market-data/types";
import type {
  AlertRule,
  NotificationRecord,
  ReportJob,
  StoredReportFile
} from "../src/modules/reports-alerts/types";

const seedNow = () => new Date("2026-07-15T12:00:00.000Z");

class SeededMarketDataProvider implements MarketDataProvider, CurrencyRateProvider {
  readonly name = "local-seeded-market-data";

  private readonly assets: Record<string, MarketAssetCandidate> = {
    LQD: this.asset(
      "LQD",
      "iShares iBoxx $ Investment Grade Corporate Bond ETF",
      "NYSEARCA",
      "USD",
      "Fixed Income"
    ),
    MSFT: this.asset("MSFT", "Microsoft Corporation", "NASDAQ", "USD", "Technology"),
    NVDA: this.asset("NVDA", "NVIDIA Corporation", "NASDAQ", "USD", "Technology"),
    SCHD: this.asset("SCHD", "Schwab US Dividend Equity ETF", "NYSEARCA", "USD", "Dividend Equity"),
    SPY: this.asset("SPY", "SPDR S&P 500 ETF Trust", "NYSEARCA", "USD", "Benchmark"),
    VNQ: this.asset("VNQ", "Vanguard Real Estate ETF", "NYSEARCA", "USD", "Real Estate"),
    VTI: this.asset("VTI", "Vanguard Total Stock Market ETF", "NYSEARCA", "USD", "ETF")
  };

  private readonly latestPrices: Record<string, number> = {
    LQD: 95.2,
    MSFT: 430,
    NVDA: 840,
    SCHD: 108.4,
    SPY: 520,
    VNQ: 81.35,
    VTI: 240
  };

  async searchAssets(query: string): Promise<MarketAssetCandidate[]> {
    const normalized = query.trim().toUpperCase();
    return Object.values(this.assets).filter(
      (entry) => entry.symbol.includes(normalized) || entry.name.toUpperCase().includes(normalized)
    );
  }

  async getLatestQuote(symbol: string): Promise<LatestQuote> {
    const normalized = symbol.trim().toUpperCase();
    const asset = this.assets[normalized];
    const price = this.latestPrices[normalized];

    if (!asset || !price) {
      throw new Error("market_data.symbol_not_supported");
    }

    return {
      assetId: asset.id,
      symbol: asset.symbol,
      providerName: this.name,
      currency: asset.currency,
      price,
      asOf: seedNow(),
      freshness: "fresh",
      updatedAt: seedNow()
    };
  }

  async getHistoricalPrices(symbol: string, range: DateRange): Promise<HistoricalPrice[]> {
    const normalized = symbol.trim().toUpperCase();
    const asset = this.assets[normalized];
    const base = this.latestPrices[normalized];

    if (!asset || !base) {
      throw new Error("market_data.symbol_not_supported");
    }

    const multipliers = this.multipliersFor(normalized);
    const endDate = parseDateOnly(range.to) ?? seedNow();
    endDate.setUTCHours(0, 0, 0, 0);

    return multipliers.map((multiplier, index) => {
      const date = new Date(endDate);
      date.setUTCDate(endDate.getUTCDate() - (multipliers.length - 1 - index));
      const close = Number((base * multiplier).toFixed(2));

      return {
        assetId: asset.id,
        symbol: asset.symbol,
        providerName: this.name,
        date: date.toISOString().slice(0, 10),
        open: close,
        high: Number((close * 1.012).toFixed(2)),
        low: Number((close * 0.988).toFixed(2)),
        close,
        adjustedClose: close,
        volume: 1_000_000 + index * 10_000,
        currency: asset.currency,
        updatedAt: seedNow()
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
      asOf: seedNow(),
      updatedAt: seedNow()
    };
  }

  private asset(
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
      assetType: "etf",
      region: "US",
      sector,
      providerName: this.name,
      isActive: true,
      updatedAt: seedNow()
    };
  }

  private multipliersFor(symbol: string): number[] {
    const curves: Record<string, number[]> = {
      LQD: [0.986, 0.99, 0.992, 0.995, 0.998, 1.001, 1.003, 1.004, 1.002, 1],
      MSFT: [0.9, 0.925, 0.948, 0.962, 0.981, 0.992, 1.006, 1.018, 1.011, 1],
      NVDA: [0.86, 0.89, 0.93, 0.91, 0.96, 0.99, 1.04, 1.07, 1.03, 1],
      SCHD: [0.955, 0.963, 0.971, 0.979, 0.988, 0.993, 0.997, 1.002, 1.004, 1],
      SPY: [0.92, 0.936, 0.951, 0.958, 0.976, 0.988, 1.001, 1.012, 1.006, 1],
      VNQ: [0.94, 0.952, 0.947, 0.961, 0.975, 0.986, 0.991, 1.004, 1.01, 1],
      VTI: [0.915, 0.932, 0.949, 0.958, 0.974, 0.986, 0.997, 1.008, 1.004, 1]
    };

    return curves[symbol] ?? [0.94, 0.96, 0.98, 1];
  }
}

type ReportsAlertsSeedStore = Awaited<
  ReturnType<typeof createSeededTestApp>
>["reportsAlerts"]["repository"] & {
  createAlert(alert: AlertRule): Promise<AlertRule>;
  createNotification(notification: NotificationRecord): Promise<NotificationRecord>;
  put(file: StoredReportFile): Promise<StoredReportFile>;
};

async function main() {
  const port = Number(process.env.PORT ?? 8000);
  const provider = new SeededMarketDataProvider();
  const { app, useCases, analytics, reportsAlerts } = await createSeededTestApp({
    marketData: {
      marketDataProvider: provider,
      currencyRateProvider: provider,
      marketDataNow: seedNow
    },
    analytics: {
      analyticsNow: seedNow
    }
  });
  const adminActor = await useCases.getActorForUserIdUseCase.execute("usr_admin");

  for (const portfolioId of ["prt_main", "prt_income"]) {
    await useCases.requestPortfolioAnalyticsRecomputeUseCase.execute(
      adminActor,
      portfolioId,
      `local-seed-${portfolioId}`
    );
  }

  while (await analytics.worker.processNext()) {
    // Drain all queued seed jobs before accepting browser traffic.
  }
  await seedReportsAlerts(reportsAlerts.repository as ReportsAlertsSeedStore);

  app.listen(port, () => {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        message: "seeded.api.started",
        port
      }) + "\n"
    );
  });
}

async function seedReportsAlerts(store: ReportsAlertsSeedStore) {
  const createdAt = new Date("2026-07-15T10:00:00.000Z");
  const completedAt = new Date("2026-07-15T10:12:00.000Z");

  const reports: ReportJob[] = [
    {
      id: "local_rpt_prt_main_ready",
      portfolioId: "prt_main",
      requestedBy: "usr_user",
      format: "pdf",
      status: "ready",
      fileKey: "local/reports/prt_main-risk.pdf",
      contentType: "application/pdf",
      createdAt,
      updatedAt: completedAt,
      completedAt
    },
    {
      id: "local_rpt_prt_main_csv",
      portfolioId: "prt_main",
      requestedBy: "usr_admin",
      format: "csv",
      status: "ready",
      fileKey: "local/reports/prt_main-exposure.csv",
      contentType: "text/csv",
      createdAt: new Date("2026-07-14T16:00:00.000Z"),
      updatedAt: new Date("2026-07-14T16:06:00.000Z"),
      completedAt: new Date("2026-07-14T16:06:00.000Z")
    },
    {
      id: "local_rpt_prt_income_failed",
      portfolioId: "prt_income",
      requestedBy: "usr_analyst",
      format: "pdf",
      status: "failed",
      failureCode: "delivery_timeout",
      createdAt: new Date("2026-07-15T08:00:00.000Z"),
      updatedAt: new Date("2026-07-15T08:18:00.000Z"),
      completedAt: new Date("2026-07-15T08:18:00.000Z")
    }
  ];

  for (const report of reports) {
    await store.createReport(report);
  }

  await store.put({
    fileKey: "local/reports/prt_main-risk.pdf",
    contentType: "application/pdf",
    body: Buffer.from("Local seeded PDF report placeholder")
  });
  await store.put({
    fileKey: "local/reports/prt_main-exposure.csv",
    contentType: "text/csv",
    body: Buffer.from("symbol,weightPercent\nMSFT,31.1\nVTI,38.4\nNVDA,30.5\n")
  });

  const alerts: AlertRule[] = [
    {
      id: "local_alert_prt_main_concentration",
      portfolioId: "prt_main",
      createdBy: "usr_user",
      title: "Concentração em tecnologia em monitoramento",
      severity: "medium",
      status: "monitoring",
      condition: { eventType: "analytics.updated" },
      createdAt: new Date("2026-07-14T09:00:00.000Z"),
      updatedAt: new Date("2026-07-15T10:20:00.000Z"),
      lastTriggeredAt: new Date("2026-07-15T10:20:00.000Z")
    },
    {
      id: "local_alert_prt_income_delivery",
      portfolioId: "prt_income",
      createdBy: "usr_analyst",
      title: "Falha de entrega de relatório de renda",
      severity: "high",
      status: "open",
      condition: { eventType: "report.generated" },
      createdAt: new Date("2026-07-15T08:00:00.000Z"),
      updatedAt: new Date("2026-07-15T08:18:00.000Z"),
      lastTriggeredAt: new Date("2026-07-15T08:18:00.000Z")
    }
  ];

  for (const alert of alerts) {
    await store.createAlert(alert);
  }

  const notifications: NotificationRecord[] = [
    {
      id: "local_ntf_prt_main_report",
      portfolioId: "prt_main",
      userId: "usr_user",
      title: "Relatório mensal pronto",
      body: "O pacote mensal de risco do Core Growth está disponível.",
      severity: "info",
      status: "unread",
      sourceType: "report",
      sourceId: "local_rpt_prt_main_ready",
      createdAt: new Date("2026-07-15T10:13:00.000Z")
    },
    {
      id: "local_ntf_prt_main_alert",
      portfolioId: "prt_main",
      title: "Analytics atualizado",
      body: "O retrato analítico foi recalculado com dados completos.",
      severity: "medium",
      status: "read",
      sourceType: "alert",
      sourceId: "local_alert_prt_main_concentration",
      createdAt: new Date("2026-07-15T10:21:00.000Z"),
      readAt: new Date("2026-07-15T10:25:00.000Z")
    },
    {
      id: "local_ntf_prt_income_failed_report",
      portfolioId: "prt_income",
      userId: "usr_analyst",
      title: "Entrega de relatório falhou",
      body: "A entrega do relatório de renda excedeu o tempo limite operacional.",
      severity: "high",
      status: "unread",
      sourceType: "report",
      sourceId: "local_rpt_prt_income_failed",
      createdAt: new Date("2026-07-15T08:20:00.000Z")
    }
  ];

  for (const notification of notifications) {
    await store.createNotification(notification);
  }
}

function parseDateOnly(value: string): Date | undefined {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
