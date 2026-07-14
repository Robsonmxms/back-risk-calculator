import { NextFunction, Request, Response } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { ApiError } from "../http";

export function authMiddleware(
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    const authorization = request.header("authorization");
    const [, token] = authorization?.match(/^Bearer\s+(.+)$/i) ?? [];

    if (!token) {
      return next(new ApiError(401, "auth.required", "Authentication required"));
    }

    try {
      (request as Request & { actor?: unknown }).actor =
        await authenticateAccessTokenUseCase.execute(token);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
