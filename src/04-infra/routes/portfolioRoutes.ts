import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { PortfolioController } from "../../03-adapters/controllers/PortfolioController";
import {
  createPortfolioSchema,
  createPortfolioTransactionSchema,
  updatePortfolioSchema
} from "../../03-adapters/controllers/portfolio-schemas";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateBody } from "../../03-adapters/validation";

export function registerPortfolioRoutes(
  router: Router,
  controller: PortfolioController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get("/portfolios", auth, asyncHandler(controller.listPortfolios));
  router.post(
    "/portfolios",
    auth,
    validateBody(createPortfolioSchema),
    asyncHandler(controller.createPortfolio)
  );
  router.get("/portfolios/:portfolioId", auth, asyncHandler(controller.getPortfolio));
  router.patch(
    "/portfolios/:portfolioId",
    auth,
    validateBody(updatePortfolioSchema),
    asyncHandler(controller.updatePortfolio)
  );
  router.get(
    "/portfolios/:portfolioId/transactions",
    auth,
    asyncHandler(controller.listTransactions)
  );
  router.post(
    "/portfolios/:portfolioId/transactions",
    auth,
    validateBody(createPortfolioTransactionSchema),
    asyncHandler(controller.recordTransaction)
  );
  router.get("/portfolios/:portfolioId/positions", auth, asyncHandler(controller.listPositions));
  router.get("/portfolios/:portfolioId/snapshots", auth, asyncHandler(controller.listSnapshots));
}
