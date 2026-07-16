import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { WorkbenchController } from "../../03-adapters/controllers/WorkbenchController";
import {
  createReviewItemSchema,
  listReviewItemsQuerySchema,
  updateReviewItemSchema
} from "../../03-adapters/controllers/workbench-schemas";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateBody, validateQuery } from "../../03-adapters/validation";

export function registerWorkbenchRoutes(
  router: Router,
  controller: WorkbenchController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get("/offices/:officeId/workbench", auth, asyncHandler(controller.getWorkbench));
  router.get(
    "/offices/:officeId/review-items",
    auth,
    validateQuery(listReviewItemsQuerySchema),
    asyncHandler(controller.listReviewItems)
  );
  router.post(
    "/offices/:officeId/review-items",
    auth,
    validateBody(createReviewItemSchema),
    asyncHandler(controller.createReviewItem)
  );
  router.patch(
    "/review-items/:reviewItemId",
    auth,
    validateBody(updateReviewItemSchema),
    asyncHandler(controller.updateReviewItem)
  );
}
