import { Router } from "express";
import { AuthController } from "../../03-adapters/controllers/AuthController";
import {
  googleLoginSchema,
  loginSchema,
  logoutSchema,
  refreshSchema
} from "../../03-adapters/schemas/AuthSchema";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateBody } from "../../03-adapters/validation";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";

export function registerAuthRoutes(
  router: Router,
  controller: AuthController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.post("/auth/login", validateBody(loginSchema), asyncHandler(controller.login));
  router.post("/auth/google", validateBody(googleLoginSchema), asyncHandler(controller.googleLogin));
  router.post("/auth/refresh", validateBody(refreshSchema), asyncHandler(controller.refresh));
  router.post(
    "/auth/logout",
    auth,
    validateBody(logoutSchema),
    asyncHandler(controller.logout)
  );
}
