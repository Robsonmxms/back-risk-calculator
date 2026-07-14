import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { UserController } from "../../03-adapters/controllers/UserController";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";

export function registerUserRoutes(
  router: Router,
  controller: UserController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);
  router.get("/users/me", auth, asyncHandler(controller.getCurrentUser));
}
