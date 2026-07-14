import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { AdminController } from "../../03-adapters/controllers/AdminController";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";

export function registerAdminRoutes(
  router: Router,
  controller: AdminController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);
  router.get("/admin/users", auth, asyncHandler(controller.listUsers));
}
