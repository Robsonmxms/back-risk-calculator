import { YahooFinanceMarketDataProvider } from "../src/04-infra/providers/market-data/YahooFinanceMarketDataProvider";
import {
  ageInSeconds,
  classifyFreshness,
  MARKET_DATA_FRESHNESS_POLICY
} from "../src/01-domain/market-data/freshness";

async function main() {
  const provider = new YahooFinanceMarketDataProvider();
  const conversion = await provider.getExchangeRate("USD", "BRL");
  const checkedAt = new Date();

  process.stdout.write(
    `${JSON.stringify(
      {
        pair: `${conversion.from}/${conversion.to}`,
        providerName: conversion.providerName,
        rate: conversion.rate,
        asOf: conversion.asOf.toISOString(),
        updatedAt: conversion.updatedAt.toISOString(),
        freshness: classifyFreshness(
          conversion.asOf,
          checkedAt,
          MARKET_DATA_FRESHNESS_POLICY.quote
        ),
        sourceAgeSeconds: ageInSeconds(conversion.asOf, checkedAt)
      },
      null,
      2
    )}\n`
  );
}

void main();
