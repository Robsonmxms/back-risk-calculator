import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { OfficeController } from "../../03-adapters/controllers/OfficeController";
import {
  createAssignmentSchema,
  createTeamSchema,
  updateOfficeSchema,
  updateTeamSchema
} from "../../03-adapters/schemas/OfficeSchema";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateBody } from "../../03-adapters/validation";

export function registerOfficeRoutes(
  router: Router,
  controller: OfficeController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get("/me/permissions", auth, asyncHandler(controller.getMyOfficePermissions));
  router.get("/offices", auth, asyncHandler(controller.listOffices));
  router.get("/offices/:officeId", auth, asyncHandler(controller.getOffice));
  router.get("/offices/:officeId/members", auth, asyncHandler(controller.listOfficeMembers));
  router.get("/offices/:officeId/teams", auth, asyncHandler(controller.listTeams));
  router.post(
    "/offices/:officeId/teams",
    auth,
    validateBody(createTeamSchema),
    asyncHandler(controller.createTeam)
  );
  router.patch(
    "/teams/:teamId",
    auth,
    validateBody(updateTeamSchema),
    asyncHandler(controller.updateTeam)
  );
  router.get("/offices/:officeId/assignments", auth, asyncHandler(controller.listAssignments));
  router.post(
    "/clients/:clientId/assignments",
    auth,
    validateBody(createAssignmentSchema),
    asyncHandler(controller.createAssignment)
  );
  router.delete("/assignments/:assignmentId", auth, asyncHandler(controller.deleteAssignment));
  router.patch(
    "/offices/:officeId",
    auth,
    validateBody(updateOfficeSchema),
    asyncHandler(controller.updateOffice)
  );
}
