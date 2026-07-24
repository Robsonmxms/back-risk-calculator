import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { ReportsAlertsController } from "../../03-adapters/controllers/ReportsAlertsController";
import {
  createAlertSchema,
  requestReportSchema,
  updateAlertSchema
} from "../../03-adapters/schemas/ReportsAlertsSchema";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateBody } from "../../03-adapters/validation";

export function registerReportsAlertsRoutes(
  router: Router,
  controller: ReportsAlertsController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.post(
    "/portfolios/:portfolioId/reports",
    auth,
    validateBody(requestReportSchema),
    asyncHandler(controller.requestReport)
  );
  router.get("/portfolios/:portfolioId/reports", auth, asyncHandler(controller.listReports));
  router.get("/reports/:reportId/download", auth, asyncHandler(controller.downloadReport));
  router.get("/portfolios/:portfolioId/alerts", auth, asyncHandler(controller.listAlerts));
  router.post(
    "/portfolios/:portfolioId/alerts",
    auth,
    validateBody(createAlertSchema),
    asyncHandler(controller.createAlert)
  );
  router.patch(
    "/alerts/:alertId",
    auth,
    validateBody(updateAlertSchema),
    asyncHandler(controller.updateAlert)
  );
  router.get("/notifications", auth, asyncHandler(controller.listNotifications));
  router.patch(
    "/notifications/:notificationId/read",
    auth,
    asyncHandler(controller.markNotificationRead)
  );
  router.get("/realtime", auth, asyncHandler(controller.subscribeRealtime));
}
