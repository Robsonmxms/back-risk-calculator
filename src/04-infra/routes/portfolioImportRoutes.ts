import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { PortfolioImportController } from "../../03-adapters/controllers/PortfolioImportController";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { parsePortfolioImportMultipart } from "../../03-adapters/middlewares/PortfolioImportMultipartMiddleware";
import { listPortfolioImportsQuerySchema } from "../../03-adapters/schemas/PortfolioImportSchema";
import { validateQuery } from "../../03-adapters/validation";

export function registerPortfolioImportRoutes(
  router: Router,
  controller: PortfolioImportController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
) {
  const auth = authMiddleware(authenticateAccessTokenUseCase);
  router.get("/portfolio-imports/template", auth, asyncHandler(controller.downloadTemplate));
  router.post(
    "/portfolio-imports",
    auth,
    parsePortfolioImportMultipart,
    asyncHandler(controller.createImport)
  );
  router.get(
    "/portfolio-imports",
    auth,
    validateQuery(listPortfolioImportsQuerySchema),
    asyncHandler(controller.listImports)
  );
  router.get("/portfolio-imports/:importId", auth, asyncHandler(controller.getImport));
  router.get(
    "/portfolio-imports/:importId/error-report",
    auth,
    asyncHandler(controller.downloadErrorReport)
  );
}
