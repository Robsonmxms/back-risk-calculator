import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { AnalyticsController } from "../../03-adapters/controllers/AnalyticsController";
import {
  analystChartJobSchema,
  analystChartsQuerySchema,
  portfolioChartsQuerySchema
} from "../../03-adapters/schemas/AnalyticsSchema";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateBody, validateQuery } from "../../03-adapters/validation";

export function registerAnalyticsRoutes(
  router: Router,
  controller: AnalyticsController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get(
    "/offices/:officeId/analytics/charts",
    auth,
    validateQuery(analystChartsQuerySchema),
    asyncHandler(controller.getAnalystCharts)
  );
  router.post(
    "/offices/:officeId/analytics/chart-jobs",
    auth,
    validateBody(analystChartJobSchema),
    asyncHandler(controller.createAnalystChartJob)
  );
  router.get(
    "/offices/:officeId/analytics/chart-jobs/:jobId",
    auth,
    asyncHandler(controller.getAnalystChartJob)
  );
  router.get(
    "/portfolios/:portfolioId/charts",
    auth,
    validateQuery(portfolioChartsQuerySchema),
    asyncHandler(controller.getPortfolioCharts)
  );
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
