import { Request, Response } from "express";
import { ListUsersUseCase } from "../../02-application/users/use-cases/list-users-use-case";
import { AuthenticatedRequest } from "../request";
import { ok } from "../http";

export class AdminController {
  constructor(private readonly listUsersUseCase: ListUsersUseCase) {}

  listUsers = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    return ok(response, { users: await this.listUsersUseCase.execute(actor) });
  };
}
