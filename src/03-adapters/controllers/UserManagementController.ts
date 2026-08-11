import { randomUUID } from "crypto";
import { Request, Response } from "express";
import {
  CreateManagedUserInput,
  CreateManagedUserUseCase,
  ListManagedUsersUseCase,
  UpdateManagedUserInput,
  UpdateManagedUserUseCase,
  UserListInput
} from "../../02-application/users/use-cases/user-management-use-cases";
import { ok } from "../http";
import { AuthenticatedRequest } from "../request";

export class UserManagementController {
  constructor(
    private readonly listManagedUsersUseCase: ListManagedUsersUseCase,
    private readonly createManagedUserUseCase: CreateManagedUserUseCase,
    private readonly updateManagedUserUseCase: UpdateManagedUserUseCase
  ) {}

  list = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const query = (
      request as Request & {
        validatedQuery: Omit<UserListInput, "perPage"> & { per_page: number };
      }
    ).validatedQuery;
    const result = await this.listManagedUsersUseCase.execute(
      actor,
      {
        role: query.role,
        search: query.search,
        status: query.status,
        page: query.page,
        perPage: query.per_page
      },
      correlationId(request)
    );
    return ok(response, result.users, { pagination: result.pagination });
  };

  create = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const user = await this.createManagedUserUseCase.execute(
      actor,
      request.body as CreateManagedUserInput,
      correlationId(request)
    );
    response.location(`/api/v1/users/${user.id}`);
    return response.status(201).json({ data: user });
  };

  update = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const params = (request as Request & { validatedParams: { userId: string } }).validatedParams;
    const user = await this.updateManagedUserUseCase.execute(
      actor,
      params.userId,
      request.body as UpdateManagedUserInput,
      correlationId(request)
    );
    return ok(response, user);
  };
}

function correlationId(request: Request): string {
  const provided = request.header("x-correlation-id")?.trim();
  return provided && provided.length <= 128 ? provided : randomUUID();
}
