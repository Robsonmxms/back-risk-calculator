import { MarketDataCache } from "../../02-application/market-data/ports";
import { DateRange, HistoricalPrice, LatestQuote } from "../../01-domain/market-data/types";

interface CacheEntry<T> {
  value: T;
  expiresAt: Date;
}

export class InMemoryMarketDataCache implements MarketDataCache {
  private readonly latestQuotes = new Map<string, CacheEntry<LatestQuote>>();
  private readonly historicalPrices = new Map<string, CacheEntry<HistoricalPrice[]>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async getLatestQuote(symbol: string): Promise<LatestQuote | undefined> {
    const entry = this.latestQuotes.get(symbol.toUpperCase());
    if (!entry || entry.expiresAt.getTime() <= this.now().getTime()) {
      return undefined;
    }

    return entry.value;
  }

  async setLatestQuote(symbol: string, quote: LatestQuote, ttlSeconds: number): Promise<void> {
    this.latestQuotes.set(symbol.toUpperCase(), {
      value: quote,
      expiresAt: this.expiresAt(ttlSeconds)
    });
  }

  async getHistoricalPrices(
    symbol: string,
    range: DateRange
  ): Promise<HistoricalPrice[] | undefined> {
    const entry = this.historicalPrices.get(this.historicalKey(symbol, range));
    if (!entry || entry.expiresAt.getTime() <= this.now().getTime()) {
      return undefined;
    }

    return entry.value;
  }

  async setHistoricalPrices(
    symbol: string,
    range: DateRange,
    prices: HistoricalPrice[],
    ttlSeconds: number
  ): Promise<void> {
    this.historicalPrices.set(this.historicalKey(symbol, range), {
      value: prices,
      expiresAt: this.expiresAt(ttlSeconds)
    });
  }

  private expiresAt(ttlSeconds: number): Date {
    return new Date(this.now().getTime() + ttlSeconds * 1000);
  }

  private historicalKey(symbol: string, range: DateRange): string {
    return `${symbol.toUpperCase()}:${range.from}:${range.to}`;
  }
}
