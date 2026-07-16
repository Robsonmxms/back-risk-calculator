import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { OfficeController } from "../../03-adapters/controllers/OfficeController";
import { updateOfficeSchema } from "../../03-adapters/controllers/office-schemas";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateBody } from "../../03-adapters/validation";

export function registerOfficeRoutes(
  router: Router,
  controller: OfficeController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get("/offices", auth, asyncHandler(controller.listOffices));
  router.get("/offices/:officeId", auth, asyncHandler(controller.getOffice));
  router.get("/offices/:officeId/members", auth, asyncHandler(controller.listOfficeMembers));
  router.patch(
    "/offices/:officeId",
    auth,
    validateBody(updateOfficeSchema),
    asyncHandler(controller.updateOffice)
  );
}
