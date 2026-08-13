import { Request, Response } from "express";
import { AuthenticatedRequest } from "../request";
import { noContent, ok } from "../http";
import { LoginUseCase } from "../../02-application/auth/use-cases/login-use-case";
import { LogoutUseCase } from "../../02-application/auth/use-cases/logout-use-case";
import { RefreshSessionUseCase } from "../../02-application/auth/use-cases/refresh-session-use-case";

export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshSessionUseCase: RefreshSessionUseCase,
    private readonly logoutUseCase: LogoutUseCase
  ) {}

  login = async (request: Request, response: Response) => {
    return ok(response, await this.loginUseCase.execute(request.body.email, request.body.password));
  };

  refresh = async (request: Request, response: Response) => {
    return ok(response, await this.refreshSessionUseCase.execute(request.body.refreshToken));
  };

  logout = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    await this.logoutUseCase.execute(request.body.refreshToken, actor.id);
    return noContent(response);
  };
}
