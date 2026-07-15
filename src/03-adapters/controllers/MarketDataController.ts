import { Request, Response } from "express";
import {
  GetMarketAssetUseCase,
  GetMarketDataProviderStatusUseCase,
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
    private readonly getProviderStatusUseCase: GetMarketDataProviderStatusUseCase
  ) {}

  searchAssets = async (request: Request, response: Response) => {
    const query = typeof request.query.q === "string" ? request.query.q : "";
    const correlationId = request.header("x-correlation-id") ?? undefined;
    const result = await this.searchAssetsUseCase.execute(query, correlationId);

    return ok(
      response,
      { assets: result.assets },
      {
        count: result.assets.length,
        providerStatus: result.providerStatus
      }
    );
  };

  getAsset = async (request: Request, response: Response) => {
    const assetId = requireAssetId(request);
    const data = await this.getAssetUseCase.execute(assetId);

    return ok(response, data, {
      freshness: data.latestQuote?.freshness ?? "stale"
    });
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
}

function requireAssetId(request: Request): string {
  const { assetId } = request.params;
  if (typeof assetId !== "string" || assetId.length === 0) {
    throw new ApiError(400, "request.invalid_asset_id", "Invalid asset id");
  }

  return assetId;
}
