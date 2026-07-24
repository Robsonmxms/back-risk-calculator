import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { ComplianceController } from "../../03-adapters/controllers/ComplianceController";
import {
  complianceChartsQuerySchema,
  createAuditExportSchema,
  listAuditEventsQuerySchema,
  listSupervisionReviewsQuerySchema,
  updateSupervisionReviewSchema
} from "../../03-adapters/schemas/ComplianceSchema";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateBody, validateQuery } from "../../03-adapters/validation";

export function registerComplianceRoutes(
  router: Router,
  controller: ComplianceController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get(
    "/offices/:officeId/compliance/charts",
    auth,
    validateQuery(complianceChartsQuerySchema),
    asyncHandler(controller.getComplianceCharts)
  );
  router.get(
    "/offices/:officeId/audit-events",
    auth,
    validateQuery(listAuditEventsQuerySchema),
    asyncHandler(controller.listAuditEvents)
  );
  router.get("/audit-events/:auditEventId", auth, asyncHandler(controller.getAuditEvent));
  router.get(
    "/offices/:officeId/supervision-reviews",
    auth,
    validateQuery(listSupervisionReviewsQuerySchema),
    asyncHandler(controller.listSupervisionReviews)
  );
  router.patch(
    "/supervision-reviews/:reviewId",
    auth,
    validateBody(updateSupervisionReviewSchema),
    asyncHandler(controller.updateSupervisionReview)
  );
  router.post(
    "/offices/:officeId/audit-exports",
    auth,
    validateBody(createAuditExportSchema),
    asyncHandler(controller.requestAuditExport)
  );
}
