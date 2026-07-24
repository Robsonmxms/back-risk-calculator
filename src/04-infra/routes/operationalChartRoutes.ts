import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { OperationalChartsController } from "../../03-adapters/controllers/OperationalChartsController";
import { operationalChartsQuerySchema } from "../../03-adapters/schemas/OperationalChartSchema";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateQuery } from "../../03-adapters/validation";

export function registerOperationalChartRoutes(
  router: Router,
  controller: OperationalChartsController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get(
    "/offices/:officeId/admin/charts",
    auth,
    validateQuery(operationalChartsQuerySchema),
    asyncHandler(controller.getOfficeAdminCharts)
  );
  router.get(
    "/admin/platform/charts",
    auth,
    validateQuery(operationalChartsQuerySchema),
    asyncHandler(controller.getPlatformAdminCharts)
  );
}
