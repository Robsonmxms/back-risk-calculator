import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { UserController } from "../../03-adapters/controllers/UserController";
import { UserManagementController } from "../../03-adapters/controllers/UserManagementController";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import {
  createManagedUserSchema,
  listManagedUsersQuerySchema,
  managedUserPathSchema,
  updateManagedUserSchema
} from "../../03-adapters/schemas/UserManagementSchema";
import { validateBody, validateParams, validateQuery } from "../../03-adapters/validation";

export function registerUserRoutes(
  router: Router,
  controller: UserController,
  managementController: UserManagementController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);
  router.get("/users/me", auth, asyncHandler(controller.getCurrentUser));
  router.get(
    "/users",
    auth,
    validateQuery(listManagedUsersQuerySchema),
    asyncHandler(managementController.list)
  );
  router.post(
    "/users",
    auth,
    validateBody(createManagedUserSchema, { stripUnknown: false }),
    asyncHandler(managementController.create)
  );
  router.patch(
    "/users/:userId",
    auth,
    validateParams(managedUserPathSchema),
    validateBody(updateManagedUserSchema, { stripUnknown: false }),
    asyncHandler(managementController.update)
  );
}
