import { describe, expect, it } from "vitest";
import { ApplicationError } from "../../src/02-application/errors/application-error";
import { YahooFinanceMarketDataProvider } from "../../src/04-infra/providers/market-data/YahooFinanceMarketDataProvider";

const consultationTime = new Date("2026-08-06T13:09:20.000Z");
const sourceTimeSeconds = Math.floor(new Date("2026-08-06T13:09:17.000Z").getTime() / 1000);

describe("YahooFinanceMarketDataProvider currency rates", () => {
  it("maps a direct Yahoo pair and preserves source and consultation timestamps", async () => {
    const urls: string[] = [];
    const provider = providerWith(async (url) => {
      urls.push(url);
      return yahooQuote("USDBRL=X", 5.1075, sourceTimeSeconds);
    });

    const rate = await provider.getExchangeRate("usd", "brl");

    expect(urls).toHaveLength(1);
    expect(decodeURIComponent(urls[0])).toContain("/chart/USDBRL=X?");
    expect(rate).toEqual({
      from: "USD",
      to: "BRL",
      rate: 5.1075,
      providerName: "yahoo",
      asOf: new Date("2026-08-06T13:09:17.000Z"),
      updatedAt: consultationTime
    });
  });

  it("inverts the reverse Yahoo pair when the direct pair is unavailable", async () => {
    const provider = providerWith(async (url) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("/chart/USDBRL=X?")) {
        return yahooError();
      }
      return yahooQuote("BRLUSD=X", 0.2, sourceTimeSeconds);
    });

    await expect(provider.getExchangeRate("USD", "BRL")).resolves.toMatchObject({
      from: "USD",
      to: "BRL",
      rate: 5,
      providerName: "yahoo"
    });
  });

  it("supports Yahoo short currency symbols for USD pairs", async () => {
    const provider = providerWith(async (url) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("/chart/BRL=X?")) {
        return yahooQuote("BRL=X", 5.11, sourceTimeSeconds);
      }
      return yahooError();
    });

    await expect(provider.getExchangeRate("USD", "BRL")).resolves.toMatchObject({
      from: "USD",
      to: "BRL",
      rate: 5.11
    });
  });

  it("returns an identity rate without calling an external provider", async () => {
    let calls = 0;
    const provider = providerWith(async () => {
      calls += 1;
      return yahooError();
    });

    await expect(provider.getExchangeRate("BRL", "brl")).resolves.toEqual({
      from: "BRL",
      to: "BRL",
      rate: 1,
      providerName: "yahoo",
      asOf: consultationTime,
      updatedAt: consultationTime
    });
    expect(calls).toBe(0);
  });

  it("falls back to Open ER API and keeps its published update time", async () => {
    const provider = providerWith(async (url) => {
      if (url.includes("open.er-api.com")) {
        return {
          result: "success",
          time_last_update_unix: sourceTimeSeconds,
          rates: { BRL: 6.25 }
        };
      }
      return yahooError();
    });

    await expect(provider.getExchangeRate("EUR", "BRL")).resolves.toEqual({
      from: "EUR",
      to: "BRL",
      rate: 6.25,
      providerName: "open.er-api",
      asOf: new Date("2026-08-06T13:09:17.000Z"),
      updatedAt: consultationTime
    });
  });

  it("does not fabricate a rate or source timestamp when every provider fails", async () => {
    const provider = providerWith(async (url) => {
      if (url.includes("open.er-api.com")) {
        throw new ApplicationError(
          "unavailable",
          "market_data.provider_http_error",
          "Market data provider returned 503"
        );
      }
      return yahooError();
    });

    await expect(provider.getExchangeRate("EUR", "BRL")).rejects.toMatchObject({
      code: "market_data.provider_http_error"
    });
  });
});

function providerWith(fetchJson: (url: string) => Promise<unknown>) {
  return new YahooFinanceMarketDataProvider(
    () => consultationTime,
    async <T>(url: string) => (await fetchJson(url)) as T
  );
}

function yahooQuote(symbol: string, price: number, regularMarketTime: number) {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            currency: "BRL",
            regularMarketPrice: price,
            regularMarketTime
          }
        }
      ],
      error: null
    }
  };
}

function yahooError() {
  return {
    chart: {
      result: [],
      error: { code: "Not Found", description: "Pair unavailable" }
    }
  };
}
