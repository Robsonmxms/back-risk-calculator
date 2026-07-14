import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { AccountController } from "../../03-adapters/controllers/AccountController";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";

export function registerAccountRoutes(
  router: Router,
  controller: AccountController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);
  router.get(
    "/accounts/:accountId/analytics/summary",
    auth,
    asyncHandler(controller.getAnalyticsSummary)
  );
}
