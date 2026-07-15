import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { MarketDataController } from "../../03-adapters/controllers/MarketDataController";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";

export function registerMarketDataRoutes(
  router: Router,
  controller: MarketDataController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get("/market-data/assets/search", auth, asyncHandler(controller.searchAssets));
  router.get("/market-data/assets/:assetId", auth, asyncHandler(controller.getAsset));
  router.post("/market-data/assets/:assetId/refresh", auth, asyncHandler(controller.refreshAsset));
  router.get("/market-data/provider-status", auth, asyncHandler(controller.getProviderStatus));
}
