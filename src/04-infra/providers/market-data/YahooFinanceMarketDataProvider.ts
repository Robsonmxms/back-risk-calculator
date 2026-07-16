import { ApplicationError } from "../../../02-application/errors/application-error";
import {
  CurrencyRateProvider,
  MarketDataProvider
} from "../../../modules/market-data/ports";
import {
  DateRange,
  Dividend,
  ExchangeRate,
  HistoricalPrice,
  LatestQuote,
  MarketAssetCandidate,
  MarketAssetType,
  Split
} from "../../../modules/market-data/types";

interface YahooSearchResponse {
  quotes?: YahooSearchQuote[];
}

interface YahooSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchDisp?: string;
  exchange?: string;
  currency?: string;
  region?: string;
  sector?: string;
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
}

interface YahooChartResult {
  meta?: {
    symbol?: string;
    currency?: string;
    regularMarketPrice?: number;
    regularMarketTime?: number;
    exchangeName?: string;
    instrumentType?: string;
    longName?: string;
    shortName?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
    adjclose?: Array<{
      adjclose?: Array<number | null>;
    }>;
  };
  events?: {
    dividends?: Record<
      string,
      {
        amount?: number;
        date?: number;
      }
    >;
    splits?: Record<
      string,
      {
        date?: number;
        numerator?: number;
        denominator?: number;
        splitRatio?: string;
      }
    >;
  };
}

interface OpenExchangeRateResponse {
  result?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

const YAHOO_BASE_URL = "https://query1.finance.yahoo.com";
const OPEN_EXCHANGE_BASE_URL = "https://open.er-api.com/v6/latest";

export class YahooFinanceMarketDataProvider
  implements MarketDataProvider, CurrencyRateProvider
{
  readonly name = "yahoo";

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly fetchJson: <T>(url: string) => Promise<T> = defaultFetchJson
  ) {}

  async searchAssets(query: string): Promise<MarketAssetCandidate[]> {
    const normalizedQuery = query.trim();
    const url = `${YAHOO_BASE_URL}/v1/finance/search?q=${encodeURIComponent(
      normalizedQuery
    )}&quotesCount=12&newsCount=0`;
    const [exactCandidate, payload] = await Promise.all([
      this.lookupAssetBySymbol(normalizedQuery).catch(() => undefined),
      this.fetchJson<YahooSearchResponse>(url)
    ]);
    const quotes = payload.quotes ?? [];

    return dedupeCandidates([
      ...(exactCandidate ? [exactCandidate] : []),
      ...quotes
      .filter((quote) => quote.symbol && quote.currency)
      .map((quote) => this.normalizeSearchQuote(quote))
    ]).slice(0, 10);
  }

  async getLatestQuote(symbol: string): Promise<LatestQuote> {
    const result = await this.getChart(symbol, "1d", "1d");
    const meta = result.meta;
    const price = meta?.regularMarketPrice;
    const currency = meta?.currency;

    if (!price || !currency) {
      throw new ApplicationError(
        "unavailable",
        "market_data.quote_unavailable",
        "Yahoo Finance did not return a latest quote"
      );
    }

    const normalizedSymbol = normalizeSymbol(meta?.symbol ?? symbol);
    const asOf = meta?.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000)
      : this.now();

    return {
      assetId: assetIdFor(normalizedSymbol),
      symbol: normalizedSymbol,
      providerName: this.name,
      currency: normalizeCurrency(currency),
      price,
      asOf,
      freshness: "fresh",
      updatedAt: this.now()
    };
  }

  async getHistoricalPrices(symbol: string, range: DateRange): Promise<HistoricalPrice[]> {
    const period1 = Math.floor(new Date(`${range.from}T00:00:00.000Z`).getTime() / 1000);
    const period2 = Math.floor(new Date(`${range.to}T23:59:59.000Z`).getTime() / 1000);
    const result = await this.getChart(
      symbol,
      undefined,
      "1d",
      `period1=${period1}&period2=${period2}&events=div%7Csplits`
    );
    const meta = result.meta;
    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0];
    const adjustedClose = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    const normalizedSymbol = normalizeSymbol(meta?.symbol ?? symbol);
    const currency = normalizeCurrency(meta?.currency ?? "USD");

    if (!quote || timestamps.length === 0) {
      throw new ApplicationError(
        "unavailable",
        "market_data.historical_prices_unavailable",
        "Yahoo Finance did not return historical prices"
      );
    }

    return timestamps
      .map((timestamp, index) => {
        const close = quote.close?.[index];
        const open = quote.open?.[index] ?? close;
        const high = quote.high?.[index] ?? close;
        const low = quote.low?.[index] ?? close;

        if (!close || !open || !high || !low) {
          return undefined;
        }

        return {
          assetId: assetIdFor(normalizedSymbol),
          symbol: normalizedSymbol,
          providerName: this.name,
          date: new Date(timestamp * 1000).toISOString().slice(0, 10),
          open,
          high,
          low,
          close,
          adjustedClose: adjustedClose[index] ?? close,
          volume: quote.volume?.[index] ?? 0,
          currency,
          updatedAt: this.now()
        };
      })
      .filter((price): price is HistoricalPrice => Boolean(price));
  }

  async getDividends(symbol: string, range: DateRange): Promise<Dividend[]> {
    const result = await this.getChartForCorporateActions(symbol, range);
    const normalizedSymbol = normalizeSymbol(result.meta?.symbol ?? symbol);
    const currency = normalizeCurrency(result.meta?.currency ?? "USD");
    const dividends = Object.values(result.events?.dividends ?? {});

    return dividends
      .filter((dividend) => dividend.date && dividend.amount)
      .map((dividend) => ({
        assetId: assetIdFor(normalizedSymbol),
        symbol: normalizedSymbol,
        providerName: this.name,
        exDate: new Date((dividend.date ?? 0) * 1000).toISOString().slice(0, 10),
        amount: dividend.amount ?? 0,
        currency,
        updatedAt: this.now()
      }));
  }

  async getSplits(symbol: string, range: DateRange): Promise<Split[]> {
    const result = await this.getChartForCorporateActions(symbol, range);
    const normalizedSymbol = normalizeSymbol(result.meta?.symbol ?? symbol);
    const splits = Object.values(result.events?.splits ?? {});

    return splits
      .filter((split) => split.date && split.numerator && split.denominator)
      .map((split) => ({
        assetId: assetIdFor(normalizedSymbol),
        symbol: normalizedSymbol,
        providerName: this.name,
        date: new Date((split.date ?? 0) * 1000).toISOString().slice(0, 10),
        ratio: Number(((split.numerator ?? 1) / (split.denominator ?? 1)).toFixed(8)),
        numerator: split.numerator ?? 1,
        denominator: split.denominator ?? 1,
        updatedAt: this.now()
      }));
  }

  async getExchangeRate(from: string, to: string): Promise<ExchangeRate> {
    const normalizedFrom = normalizeCurrency(from);
    const normalizedTo = normalizeCurrency(to);
    if (normalizedFrom === normalizedTo) {
      return {
        from: normalizedFrom,
        to: normalizedTo,
        rate: 1,
        providerName: this.name,
        asOf: this.now(),
        updatedAt: this.now()
      };
    }

    const yahooRate = await this.getYahooExchangeRate(normalizedFrom, normalizedTo).catch(
      () => undefined
    );
    if (yahooRate) {
      return yahooRate;
    }

    return this.getFallbackExchangeRate(normalizedFrom, normalizedTo);
  }

  private async getYahooExchangeRate(from: string, to: string): Promise<ExchangeRate> {
    const direct = await this.getYahooCurrencyPair(`${from}${to}=X`, false).catch(() => undefined);
    if (direct) {
      return direct;
    }

    const inverse = await this.getYahooCurrencyPair(`${to}${from}=X`, true).catch(
      () => undefined
    );
    if (inverse) {
      return inverse;
    }

    if (from === "USD") {
      return this.getYahooCurrencyPair(`${to}=X`, false);
    }

    if (to === "USD") {
      return this.getYahooCurrencyPair(`${from}=X`, true);
    }

    throw new ApplicationError(
      "unavailable",
      "market_data.currency_pair_unavailable",
      "Yahoo Finance did not return the requested currency pair"
    );
  }

  private async getYahooCurrencyPair(symbol: string, invert: boolean): Promise<ExchangeRate> {
    const quote = await this.getLatestQuote(symbol);
    const price = invert ? 1 / quote.price : quote.price;
    const compact = symbol.replace("=X", "");
    const [from, to] =
      compact.length === 6
        ? [compact.slice(0, 3), compact.slice(3, 6)]
        : ["USD", compact.slice(0, 3)];

    return {
      from: invert ? to : from,
      to: invert ? from : to,
      rate: Number(price.toFixed(8)),
      providerName: this.name,
      asOf: quote.asOf,
      updatedAt: this.now()
    };
  }

  private async getFallbackExchangeRate(from: string, to: string): Promise<ExchangeRate> {
    const payload = await this.fetchJson<OpenExchangeRateResponse>(
      `${OPEN_EXCHANGE_BASE_URL}/${encodeURIComponent(from)}`
    );
    const rate = payload.rates?.[to];

    if (payload.result === "error" || !rate) {
      throw new ApplicationError(
        "unavailable",
        "market_data.currency_rate_unavailable",
        "Currency conversion provider unavailable"
      );
    }

    return {
      from,
      to,
      rate,
      providerName: "open.er-api",
      asOf: payload.time_last_update_unix
        ? new Date(payload.time_last_update_unix * 1000)
        : this.now(),
      updatedAt: this.now()
    };
  }

  private normalizeSearchQuote(quote: YahooSearchQuote): MarketAssetCandidate {
    const symbol = normalizeSymbol(quote.symbol ?? "");

    return {
      id: assetIdFor(symbol),
      symbol,
      providerSymbol: symbol,
      name: quote.longname ?? quote.shortname ?? symbol,
      exchange: quote.exchDisp ?? quote.exchange,
      currency: normalizeCurrency(quote.currency ?? "USD"),
      assetType: assetTypeFor(quote.quoteType),
      region: quote.region,
      sector: quote.sector,
      providerName: this.name,
      isActive: true,
      updatedAt: this.now()
    };
  }

  private async lookupAssetBySymbol(symbol: string): Promise<MarketAssetCandidate | undefined> {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol || normalizedSymbol.includes(" ")) {
      return undefined;
    }

    const result = await this.getChart(normalizedSymbol, "1d", "1d");
    const meta = result.meta;
    const currency = meta?.currency;
    if (!currency) {
      return undefined;
    }

    const resolvedSymbol = normalizeSymbol(meta?.symbol ?? normalizedSymbol);

    return {
      id: assetIdFor(resolvedSymbol),
      symbol: resolvedSymbol,
      providerSymbol: resolvedSymbol,
      name: meta?.longName ?? meta?.shortName ?? resolvedSymbol,
      exchange: meta?.exchangeName,
      currency: normalizeCurrency(currency),
      assetType: assetTypeFor(meta?.instrumentType),
      providerName: this.name,
      isActive: true,
      updatedAt: this.now()
    };
  }

  private async getChartForCorporateActions(
    symbol: string,
    range: DateRange
  ): Promise<YahooChartResult> {
    const period1 = Math.floor(new Date(`${range.from}T00:00:00.000Z`).getTime() / 1000);
    const period2 = Math.floor(new Date(`${range.to}T23:59:59.000Z`).getTime() / 1000);
    return this.getChart(
      symbol,
      undefined,
      "1d",
      `period1=${period1}&period2=${period2}&events=div%7Csplits`
    );
  }

  private async getChart(
    symbol: string,
    range: string | undefined,
    interval: string,
    extraQuery?: string
  ): Promise<YahooChartResult> {
    const query = [
      range ? `range=${encodeURIComponent(range)}` : undefined,
      `interval=${encodeURIComponent(interval)}`,
      extraQuery
    ]
      .filter(Boolean)
      .join("&");
    const url = `${YAHOO_BASE_URL}/v8/finance/chart/${encodeURIComponent(
      normalizeSymbol(symbol)
    )}?${query}`;
    const payload = await this.fetchJson<YahooChartResponse>(url);
    const error = payload.chart?.error;
    const result = payload.chart?.result?.[0];

    if (error || !result) {
      throw new ApplicationError(
        "unavailable",
        "market_data.yahoo_chart_unavailable",
        error?.description ?? "Yahoo Finance chart data unavailable"
      );
    }

    return result;
  }
}

async function defaultFetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "risk-calculator/0.1"
    }
  });

  if (!response.ok) {
    throw new ApplicationError(
      "unavailable",
      "market_data.provider_http_error",
      `Market data provider returned ${response.status}`
    );
  }

  return (await response.json()) as T;
}

function assetTypeFor(quoteType?: string): MarketAssetType {
  switch (quoteType?.toUpperCase()) {
    case "ETF":
      return "etf";
    case "MUTUALFUND":
      return "fund";
    case "CRYPTOCURRENCY":
      return "crypto";
    default:
      return "stock";
  }
}

function assetIdFor(symbol: string): string {
  return `asset-yahoo-${symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

function dedupeCandidates(candidates: MarketAssetCandidate[]): MarketAssetCandidate[] {
  const bySymbol = new Map<string, MarketAssetCandidate>();

  for (const candidate of candidates) {
    bySymbol.set(candidate.symbol.toUpperCase(), candidate);
  }

  return Array.from(bySymbol.values());
}
