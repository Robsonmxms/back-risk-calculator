import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { MarketDataController } from "../../03-adapters/controllers/MarketDataController";
import { assetHistoryQuerySchema } from "../../03-adapters/controllers/market-data-schemas";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateQuery } from "../../03-adapters/validation";

export function registerMarketDataRoutes(
  router: Router,
  controller: MarketDataController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get("/market-data/assets/search", auth, asyncHandler(controller.searchAssets));
  router.get("/market-data/exchanges", auth, asyncHandler(controller.listExchanges));
  router.get("/market-data/fx-rate", auth, asyncHandler(controller.convertCurrency));
  router.get(
    "/market-data/assets/:assetId/trade-price",
    auth,
    asyncHandler(controller.getTradePrice)
  );
  router.get(
    "/market-data/assets/:assetId/history",
    auth,
    validateQuery(assetHistoryQuerySchema),
    asyncHandler(controller.getAssetHistory)
  );
  router.get("/market-data/assets/:assetId", auth, asyncHandler(controller.getAsset));
  router.post("/market-data/assets/:assetId/refresh", auth, asyncHandler(controller.refreshAsset));
  router.get("/market-data/provider-status", auth, asyncHandler(controller.getProviderStatus));
}
