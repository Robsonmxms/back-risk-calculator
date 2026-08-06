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

interface BrapiAssetPayload {
  stock: string;
  name: string;
  exchange: string;
  currency: string;
  type: "stock" | "etf";
  region: string;
  sector?: string;
  close: number;
}

const FIXTURE_ASSETS: BrapiAssetPayload[] = [
  {
    stock: "MSFT",
    name: "Microsoft Corporation",
    exchange: "NASDAQ",
    currency: "USD",
    type: "stock",
    region: "US",
    sector: "Technology",
    close: 420.44
  },
  {
    stock: "NVDA",
    name: "NVIDIA Corporation",
    exchange: "NASDAQ",
    currency: "USD",
    type: "stock",
    region: "US",
    sector: "Technology",
    close: 804.11
  },
  {
    stock: "VTI",
    name: "Vanguard Total Stock Market ETF",
    exchange: "NYSEARCA",
    currency: "USD",
    type: "etf",
    region: "US",
    sector: "ETF",
    close: 229.34
  },
  {
    stock: "IEF",
    name: "iShares 7-10 Year Treasury Bond ETF",
    exchange: "NASDAQ",
    currency: "USD",
    type: "etf",
    region: "US",
    sector: "Fixed income",
    close: 92.48
  },
  {
    stock: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    exchange: "NYSEARCA",
    currency: "USD",
    type: "etf",
    region: "US",
    sector: "Benchmark",
    close: 512.74
  },
  {
    stock: "PETR4",
    name: "Petroleo Brasileiro SA Petrobras PN",
    exchange: "B3",
    currency: "BRL",
    type: "stock",
    region: "BR",
    sector: "Energy",
    close: 38.16
  },
  {
    stock: "VALE3",
    name: "Vale SA",
    exchange: "B3",
    currency: "BRL",
    type: "stock",
    region: "BR",
    sector: "Materials",
    close: 61.77
  },
  {
    stock: "ITUB4",
    name: "Itau Unibanco Holding SA PN",
    exchange: "B3",
    currency: "BRL",
    type: "stock",
    region: "BR",
    sector: "Financials",
    close: 34.92
  }
];

export class BrapiMarketDataProvider implements MarketDataProvider, CurrencyRateProvider {
  readonly name = "brapi";

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly fixtures: BrapiAssetPayload[] = FIXTURE_ASSETS
  ) {}

  async searchAssets(query: string): Promise<MarketAssetCandidate[]> {
    const normalizedQuery = query.trim().toUpperCase();

    return this.fixtures
      .filter(
        (asset) =>
          asset.stock.includes(normalizedQuery) ||
          asset.name.toUpperCase().includes(normalizedQuery)
      )
      .slice(0, 10)
      .map((asset) => this.normalizeAsset(asset));
  }

  async getLatestQuote(symbol: string): Promise<LatestQuote> {
    const asset = this.requireAsset(symbol);
    return {
      assetId: assetIdFor(asset.stock),
      symbol: asset.stock,
      providerName: this.name,
      currency: asset.currency,
      price: asset.close,
      asOf: this.now(),
      freshness: "fresh",
      updatedAt: this.now()
    };
  }

  async getHistoricalPrices(symbol: string, range: DateRange): Promise<HistoricalPrice[]> {
    const asset = this.requireAsset(symbol);
    const toDate = new Date(`${range.to}T00:00:00.000Z`);
    const previousDate = new Date(toDate);
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);

    return [previousDate, toDate].map((date, index) => {
      const close = Number((asset.close - (1 - index) * 1.25).toFixed(2));
      return {
        assetId: assetIdFor(asset.stock),
        symbol: asset.stock,
        providerName: this.name,
        date: date.toISOString().slice(0, 10),
        open: Number((close * 0.98).toFixed(2)),
        high: Number((close * 1.02).toFixed(2)),
        low: Number((close * 0.97).toFixed(2)),
        close,
        adjustedClose: close,
        volume: asset.region === "BR" ? 12_000_000 : 8_500_000,
        currency: asset.currency,
        updatedAt: this.now()
      };
    });
  }

  async getDividends(symbol: string, _range: DateRange): Promise<Dividend[]> {
    const asset = this.requireAsset(symbol);
    if (asset.type === "etf") {
      return [];
    }

    return [
      {
        assetId: assetIdFor(asset.stock),
        symbol: asset.stock,
        providerName: this.name,
        exDate: "2026-06-15",
        paymentDate: "2026-07-01",
        amount: asset.region === "BR" ? 0.42 : 0.68,
        currency: asset.currency,
        updatedAt: this.now()
      }
    ];
  }

  async getSplits(symbol: string, _range: DateRange): Promise<Split[]> {
    const asset = this.requireAsset(symbol);
    return [
      {
        assetId: assetIdFor(asset.stock),
        symbol: asset.stock,
        providerName: this.name,
        date: "2026-05-01",
        ratio: 1,
        numerator: 1,
        denominator: 1,
        updatedAt: this.now()
      }
    ];
  }

  async getExchangeRate(from: string, to: string): Promise<ExchangeRate> {
    const normalizedFrom = from.trim().toUpperCase();
    const normalizedTo = to.trim().toUpperCase();
    const rate = fixtureExchangeRate(normalizedFrom, normalizedTo);

    if (rate === undefined) {
      throw new ApplicationError(
        "unavailable",
        "market_data.currency_pair_not_supported",
        "Currency pair is not supported by the configured provider"
      );
    }

    return {
      from: normalizedFrom,
      to: normalizedTo,
      rate,
      providerName: this.name,
      asOf: this.now(),
      updatedAt: this.now()
    };
  }

  private requireAsset(symbol: string): BrapiAssetPayload {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const asset = this.fixtures.find((entry) => entry.stock === normalizedSymbol);
    if (!asset) {
      throw new ApplicationError(
        "unavailable",
        "market_data.symbol_not_supported",
        "Symbol is not supported by the configured provider"
      );
    }

    return asset;
  }

  private normalizeAsset(asset: BrapiAssetPayload): MarketAssetCandidate {
    return {
      id: assetIdFor(asset.stock),
      symbol: asset.stock,
      providerSymbol: asset.stock,
      name: asset.name,
      exchange: asset.exchange,
      currency: asset.currency,
      assetType: asset.type,
      region: asset.region,
      sector: asset.sector,
      providerName: this.name,
      isActive: true,
      updatedAt: this.now()
    };
  }
}

function assetIdFor(symbol: string): string {
  return `asset-${symbol.toLowerCase()}`;
}

function fixtureExchangeRate(from: string, to: string): number | undefined {
  if (from === to) {
    return 1;
  }

  const usdRates: Record<string, number> = {
    BRL: 5.42,
    EUR: 0.92,
    GBP: 0.78,
    JPY: 156.4,
    USD: 1
  };

  if (from === "USD" && usdRates[to]) {
    return usdRates[to];
  }

  if (to === "USD" && usdRates[from]) {
    return Number((1 / usdRates[from]).toFixed(8));
  }

  if (usdRates[from] && usdRates[to]) {
    return Number((usdRates[to] / usdRates[from]).toFixed(8));
  }

  return undefined;
}
