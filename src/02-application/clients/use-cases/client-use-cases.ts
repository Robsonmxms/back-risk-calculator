import { randomUUID } from "crypto";
import { Actor } from "../../../01-domain/auth/actor";
import {
  ClientDetail,
  ClientOnboardingStatus,
  ClientStatus,
  Household,
  HouseholdStatus
} from "../../../01-domain/clients/client";
import { ROLE_PERMISSION_MATRIX, PermissionService } from "../../auth/permission-service";
import { ApplicationError } from "../../errors/application-error";
import { ClientFilters, ClientRepository } from "../../ports/repositories";

export class ListClientsUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(actor: Actor, officeId: string, filters: ClientFilters) {
    const evaluation = await this.permissions.evaluate(actor, officeId);
    const canReadOffice = ROLE_PERMISSION_MATRIX[evaluation.role].includes("client.read");
    const visibleClientIds = canReadOffice
      ? undefined
      : new Set(
          evaluation.assignments
            .filter(
              (assignment) =>
                !assignment.revokedAt &&
                assignment.resourceType === "client" &&
                assignment.permissions.includes("client.read")
            )
            .map((assignment) => assignment.resourceId)
        );

    if (visibleClientIds && visibleClientIds.size === 0) {
      return [];
    }

    return this.clients.listClients(officeId, filters, visibleClientIds);
  }
}

export class GetClientDetailUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(actor: Actor, clientId: string): Promise<ClientDetail> {
    const client = await this.clients.findClientById(clientId);
    if (!client) {
      throw new ApplicationError("not_found", "client.not_found", "Client not found");
    }

    await this.permissions.assertPermission(actor, client.officeId, "client.read", {
      resourceType: "client",
      resourceId: client.id
    });
    return client;
  }
}

export class CreateClientUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    input: {
      householdId?: string;
      name: string;
      email: string;
      phone?: string;
      documentLabel?: string;
      onboardingStatus?: ClientOnboardingStatus;
      advisorUserId?: string;
      riskProfileDescriptor?: string;
      notes?: string;
    }
  ): Promise<ClientDetail> {
    await this.permissions.assertPermission(actor, officeId, "client.manage");
    const createdAt = this.now();
    return this.clients.createClient({
      id: randomUUID(),
      officeId,
      householdId: input.householdId,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || undefined,
      documentLabel: input.documentLabel?.trim() || undefined,
      status: "active",
      onboardingStatus: input.onboardingStatus ?? "onboarding",
      advisorUserId: input.advisorUserId,
      riskProfileDescriptor:
        input.riskProfileDescriptor?.trim() || "Risk profile not yet classified",
      notes: input.notes?.trim() || undefined,
      createdAt,
      updatedAt: createdAt
    });
  }
}

export class UpdateClientUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    clientId: string,
    input: {
      householdId?: string;
      name?: string;
      email?: string;
      phone?: string;
      documentLabel?: string;
      status?: ClientStatus;
      onboardingStatus?: ClientOnboardingStatus;
      advisorUserId?: string;
      riskProfileDescriptor?: string;
      notes?: string;
    }
  ): Promise<ClientDetail> {
    const client = await this.clients.findClientById(clientId);
    if (!client) {
      throw new ApplicationError("not_found", "client.not_found", "Client not found");
    }

    await this.permissions.assertPermission(actor, client.officeId, "client.manage", {
      resourceType: "client",
      resourceId: client.id
    });

    const status = input.status;
    const updated = await this.clients.updateClient(clientId, {
      householdId: input.householdId,
      name: input.name?.trim(),
      email: input.email?.trim().toLowerCase(),
      phone: input.phone?.trim() || undefined,
      documentLabel: input.documentLabel?.trim() || undefined,
      status,
      onboardingStatus: input.onboardingStatus,
      advisorUserId: input.advisorUserId,
      riskProfileDescriptor: input.riskProfileDescriptor?.trim(),
      notes: input.notes?.trim() || undefined,
      updatedAt: this.now(),
      archivedAt: status === "archived" ? this.now() : undefined
    });

    if (!updated) {
      throw new ApplicationError("not_found", "client.not_found", "Client not found");
    }
    return updated;
  }
}

export class ListHouseholdsUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(actor: Actor, officeId: string): Promise<Household[]> {
    await this.permissions.assertPermission(actor, officeId, "client.read");
    return this.clients.listHouseholds(officeId);
  }
}

export class CreateHouseholdUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor, officeId: string, input: { name: string }): Promise<Household> {
    await this.permissions.assertPermission(actor, officeId, "client.manage");
    const createdAt = this.now();
    return this.clients.createHousehold({
      id: randomUUID(),
      officeId,
      name: input.name.trim(),
      status: "active",
      createdAt,
      updatedAt: createdAt
    });
  }
}

export class UpdateHouseholdUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    householdId: string,
    input: { name?: string; status?: HouseholdStatus }
  ): Promise<Household> {
    const household = await this.clients.findHouseholdById(householdId);
    if (!household) {
      throw new ApplicationError("not_found", "household.not_found", "Household not found");
    }

    await this.permissions.assertPermission(actor, household.officeId, "client.manage");
    const updated = await this.clients.updateHousehold(householdId, {
      name: input.name?.trim(),
      status: input.status,
      updatedAt: this.now()
    });
    if (!updated) {
      throw new ApplicationError("not_found", "household.not_found", "Household not found");
    }
    return updated;
  }
}
