import { Request, Response } from "express";
import {
  ConvertCurrencyUseCase,
  GetAssetHistoryUseCase,
  GetMarketAssetUseCase,
  GetMarketDataProviderStatusUseCase,
  GetTradePriceUseCase,
  ListMarketExchangesUseCase,
  RequestMarketDataRefreshUseCase,
  SearchMarketAssetsUseCase
} from "../../modules/market-data/use-cases";
import { AuthenticatedRequest } from "../request";
import { ApiError, ok } from "../http";

export class MarketDataController {
  constructor(
    private readonly searchAssetsUseCase: SearchMarketAssetsUseCase,
    private readonly getAssetUseCase: GetMarketAssetUseCase,
    private readonly requestRefreshUseCase: RequestMarketDataRefreshUseCase,
    private readonly getProviderStatusUseCase: GetMarketDataProviderStatusUseCase,
    private readonly convertCurrencyUseCase: ConvertCurrencyUseCase,
    private readonly listMarketExchangesUseCase: ListMarketExchangesUseCase,
    private readonly getTradePriceUseCase: GetTradePriceUseCase,
    private readonly getAssetHistoryUseCase: GetAssetHistoryUseCase
  ) {}

  searchAssets = async (request: Request, response: Response) => {
    const query = typeof request.query.q === "string" ? request.query.q : "";
    const exchangeCode =
      typeof request.query.exchange === "string" ? request.query.exchange : undefined;
    const correlationId = request.header("x-correlation-id") ?? undefined;
    const result = await this.searchAssetsUseCase.execute({ query, exchangeCode }, correlationId);

    return ok(
      response,
      { assets: result.assets },
      {
        count: result.assets.length,
        providerStatus: result.providerStatus,
        exchange: result.exchange?.code
      }
    );
  };

  listExchanges = async (_request: Request, response: Response) => {
    const exchanges = await this.listMarketExchangesUseCase.execute();

    return ok(response, { exchanges }, { count: exchanges.length });
  };

  getAsset = async (request: Request, response: Response) => {
    const assetId = requireAssetId(request);
    const data = await this.getAssetUseCase.execute(assetId);

    return ok(response, data, {
      freshness: data.latestQuote?.freshness ?? "stale"
    });
  };

  getAssetHistory = async (request: Request, response: Response) => {
    const assetId = requireAssetId(request);
    const query = (request as Request & {
      validatedQuery?: { from?: string; to?: string; interval?: "daily" | "weekly" | "monthly" };
    }).validatedQuery;
    const data = await this.getAssetHistoryUseCase.execute(assetId, query);

    return ok(response, data, {
      count: data.history.length,
      providerName: data.asset.providerName
    });
  };

  getTradePrice = async (request: Request, response: Response) => {
    const assetId = requireAssetId(request);
    const tradeDate = typeof request.query.tradeDate === "string" ? request.query.tradeDate : "";
    const quantity =
      typeof request.query.quantity === "string" ? Number(request.query.quantity) : Number.NaN;
    const correlationId = request.header("x-correlation-id") ?? undefined;
    const tradePrice = await this.getTradePriceUseCase.execute(
      { assetId, tradeDate, quantity },
      correlationId
    );

    return ok(
      response,
      { tradePrice },
      {
        providerName: tradePrice.providerName,
        priceSource: tradePrice.priceSource,
        asOf: tradePrice.asOf.toISOString()
      }
    );
  };

  refreshAsset = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const assetId = requireAssetId(request);
    const correlationId = request.header("x-correlation-id") ?? undefined;
    const job = await this.requestRefreshUseCase.execute(actor, assetId, correlationId);

    return response.status(202).json({
      data: {
        jobId: job.id,
        status: job.status,
        assetId: job.assetId,
        symbol: job.symbol
      },
      meta: {
        correlationId: job.correlationId
      }
    });
  };

  getProviderStatus = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    return ok(response, { provider: await this.getProviderStatusUseCase.execute(actor) });
  };

  convertCurrency = async (request: Request, response: Response) => {
    const from = typeof request.query.from === "string" ? request.query.from : "USD";
    const to = typeof request.query.to === "string" ? request.query.to : "USD";
    const amount = typeof request.query.amount === "string" ? Number(request.query.amount) : 1;
    const correlationId = request.header("x-correlation-id") ?? undefined;
    const conversion = await this.convertCurrencyUseCase.execute(
      { from, to, amount },
      correlationId
    );

    return ok(
      response,
      { conversion },
      {
        providerName: conversion.providerName,
        asOf: conversion.asOf.toISOString()
      }
    );
  };
}

function requireAssetId(request: Request): string {
  const { assetId } = request.params;
  if (typeof assetId !== "string" || assetId.length === 0) {
    throw new ApiError(400, "request.invalid_asset_id", "Invalid asset id");
  }

  return assetId;
}
