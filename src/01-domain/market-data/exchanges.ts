import { MarketAsset, MarketExchange } from "./types";

export const MARKET_EXCHANGES: MarketExchange[] = [
  {
    code: "NASDAQ",
    name: "Nasdaq Stock Market",
    country: "United States",
    currency: "USD",
    yahooSuffix: "",
    aliases: ["NASDAQ", "NMS", "NGM", "NCM"]
  },
  {
    code: "NYSE",
    name: "New York Stock Exchange",
    country: "United States",
    currency: "USD",
    yahooSuffix: "",
    aliases: ["NYSE", "NYQ"]
  },
  {
    code: "NYSEARCA",
    name: "NYSE Arca",
    country: "United States",
    currency: "USD",
    yahooSuffix: "",
    aliases: ["NYSEARCA", "PCX", "ARCA"]
  },
  {
    code: "B3",
    name: "B3 - Brasil Bolsa Balcao",
    country: "Brazil",
    currency: "BRL",
    yahooSuffix: ".SA",
    aliases: ["B3", "SAO", "SAO PAULO", "SAO PAOLO", "SAO PAULO STOCK EXCHANGE"]
  },
  {
    code: "LSE",
    name: "London Stock Exchange",
    country: "United Kingdom",
    currency: "GBP",
    yahooSuffix: ".L",
    aliases: ["LSE", "LONDON", "LSE DELAYED"]
  },
  {
    code: "TSX",
    name: "Toronto Stock Exchange",
    country: "Canada",
    currency: "CAD",
    yahooSuffix: ".TO",
    aliases: ["TSX", "TORONTO", "TOR"]
  },
  {
    code: "TSE",
    name: "Tokyo Stock Exchange",
    country: "Japan",
    currency: "JPY",
    yahooSuffix: ".T",
    aliases: ["TSE", "TOKYO", "JPX"]
  },
  {
    code: "XETRA",
    name: "Xetra",
    country: "Germany",
    currency: "EUR",
    yahooSuffix: ".DE",
    aliases: ["XETRA", "GERMAN", "GER"]
  }
];

export function findMarketExchange(code?: string): MarketExchange | undefined {
  if (!code) {
    return undefined;
  }

  const normalizedCode = code.trim().toUpperCase();
  return MARKET_EXCHANGES.find((exchange) => exchange.code === normalizedCode);
}

export function symbolForExchangeQuery(query: string, exchange?: MarketExchange): string {
  const normalizedQuery = query.trim().toUpperCase();
  if (!exchange?.yahooSuffix || normalizedQuery.includes(".") || normalizedQuery.includes("=")) {
    return normalizedQuery;
  }

  return `${normalizedQuery}${exchange.yahooSuffix}`;
}

export function assetMatchesExchange(asset: MarketAsset, exchange?: MarketExchange): boolean {
  if (!exchange) {
    return true;
  }

  const symbol = asset.symbol.toUpperCase();
  const providerSymbol = asset.providerSymbol.toUpperCase();
  const exchangeText = `${asset.exchange ?? ""} ${asset.region ?? ""}`.toUpperCase();
  const suffix = exchange.yahooSuffix.toUpperCase();

  if (suffix && (symbol.endsWith(suffix) || providerSymbol.endsWith(suffix))) {
    return true;
  }

  if (asset.exchange?.toUpperCase() === exchange.code) {
    return true;
  }

  return exchange.aliases.some((alias) => exchangeText.includes(alias.toUpperCase()));
}
