import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { ReportDeliveryController } from "../../03-adapters/controllers/ReportDeliveryController";
import {
  createReportPackageSchema,
  listReportPackagesQuerySchema,
  updateReportPackageSchema
} from "../../03-adapters/schemas/ReportDeliverySchema";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateBody, validateQuery } from "../../03-adapters/validation";

export function registerReportDeliveryRoutes(
  router: Router,
  controller: ReportDeliveryController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.post(
    "/clients/:clientId/report-packages",
    auth,
    validateBody(createReportPackageSchema),
    asyncHandler(controller.createReportPackage)
  );
  router.get(
    "/clients/:clientId/report-packages",
    auth,
    validateQuery(listReportPackagesQuerySchema),
    asyncHandler(controller.listClientReportPackages)
  );
  router.get("/report-packages/:packageId", auth, asyncHandler(controller.getReportPackage));
  router.patch(
    "/report-packages/:packageId",
    auth,
    validateBody(updateReportPackageSchema),
    asyncHandler(controller.updateReportPackage)
  );
  router.post(
    "/report-packages/:packageId/approve",
    auth,
    asyncHandler(controller.approveReportPackage)
  );
  router.post(
    "/report-packages/:packageId/deliver",
    auth,
    asyncHandler(controller.deliverReportPackage)
  );
  router.post(
    "/report-packages/:packageId/revoke",
    auth,
    asyncHandler(controller.revokeReportPackage)
  );
  router.get("/client-portal", auth, asyncHandler(controller.getClientPortal));
}
