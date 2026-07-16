import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { AnalyticsController } from "../../03-adapters/controllers/AnalyticsController";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";

export function registerAnalyticsRoutes(
  router: Router,
  controller: AnalyticsController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get(
    "/portfolios/:portfolioId/analytics",
    auth,
    asyncHandler(controller.getPortfolioAnalytics)
  );
  router.post(
    "/portfolios/:portfolioId/analytics/recompute",
    auth,
    asyncHandler(controller.requestRecompute)
  );
  router.get(
    "/portfolios/:portfolioId/analytics/history",
    auth,
    asyncHandler(controller.listHistory)
  );
}
