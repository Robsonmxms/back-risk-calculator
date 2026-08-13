import { Request, Response } from "express";
import { GetCurrentUserUseCase } from "../../02-application/users/use-cases/get-current-user-use-case";
import { AuthenticatedRequest } from "../request";
import { ok } from "../http";

export class UserController {
  constructor(private readonly getCurrentUserUseCase: GetCurrentUserUseCase) {}

  getCurrentUser = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    return ok(response, await this.getCurrentUserUseCase.execute(actor));
  };
}
