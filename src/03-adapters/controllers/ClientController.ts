import { Request, Response } from "express";
import {
  CreateClientUseCase,
  CreateHouseholdUseCase,
  GetClientDetailUseCase,
  ListClientsUseCase,
  ListHouseholdsUseCase,
  UpdateClientUseCase,
  UpdateHouseholdUseCase
} from "../../02-application/clients/use-cases/client-use-cases";
import { ClientFilters } from "../../02-application/ports/repositories";
import { ClientDetail, ClientSummary, Household } from "../../01-domain/clients/client";
import { ApiError, ok } from "../http";
import { AuthenticatedRequest } from "../request";

export class ClientController {
  constructor(
    private readonly listClientsUseCase: ListClientsUseCase,
    private readonly createClientUseCase: CreateClientUseCase,
    private readonly getClientDetailUseCase: GetClientDetailUseCase,
    private readonly updateClientUseCase: UpdateClientUseCase,
    private readonly listHouseholdsUseCase: ListHouseholdsUseCase,
    private readonly createHouseholdUseCase: CreateHouseholdUseCase,
    private readonly updateHouseholdUseCase: UpdateHouseholdUseCase
  ) {}

  listClients = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const clients = await this.listClientsUseCase.execute(
      actor,
      requireOfficeId(request),
      ((request as Request & { validatedQuery?: ClientFilters }).validatedQuery ?? {})
    );
    return ok(response, { clients: clients.map(serializeClientSummary) }, { count: clients.length });
  };

  createClient = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const client = await this.createClientUseCase.execute(
      actor,
      requireOfficeId(request),
      request.body
    );
    return ok(response.status(201), serializeClientDetail(client));
  };

  getClient = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const client = await this.getClientDetailUseCase.execute(actor, requireClientId(request));
    return ok(response, serializeClientDetail(client));
  };

  updateClient = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const client = await this.updateClientUseCase.execute(
      actor,
      requireClientId(request),
      request.body
    );
    return ok(response, serializeClientDetail(client));
  };

  listHouseholds = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const households = await this.listHouseholdsUseCase.execute(actor, requireOfficeId(request));
    return ok(response, { households: households.map(serializeHousehold) }, { count: households.length });
  };

  createHousehold = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const household = await this.createHouseholdUseCase.execute(
      actor,
      requireOfficeId(request),
      request.body
    );
    return ok(response.status(201), serializeHousehold(household));
  };

  updateHousehold = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const household = await this.updateHouseholdUseCase.execute(
      actor,
      requireHouseholdId(request),
      request.body
    );
    return ok(response, serializeHousehold(household));
  };
}

function requireOfficeId(request: Request): string {
  const { officeId } = request.params;
  if (typeof officeId !== "string") {
    throw new ApiError(400, "request.invalid_office_id", "Invalid office id");
  }
  return officeId;
}

function requireClientId(request: Request): string {
  const { clientId } = request.params;
  if (typeof clientId !== "string") {
    throw new ApiError(400, "request.invalid_client_id", "Invalid client id");
  }
  return clientId;
}

function requireHouseholdId(request: Request): string {
  const { householdId } = request.params;
  if (typeof householdId !== "string") {
    throw new ApiError(400, "request.invalid_household_id", "Invalid household id");
  }
  return householdId;
}

function serializeClientSummary(client: ClientSummary) {
  return {
    ...client,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    archivedAt: client.archivedAt?.toISOString()
  };
}

function serializeClientDetail(client: ClientDetail) {
  return {
    ...serializeClientSummary(client),
    household: client.household ? serializeHousehold(client.household) : undefined,
    accounts: client.accounts,
    portfolios: client.portfolios
  };
}

function serializeHousehold(household: Household) {
  return {
    ...household,
    createdAt: household.createdAt.toISOString(),
    updatedAt: household.updatedAt.toISOString()
  };
}
