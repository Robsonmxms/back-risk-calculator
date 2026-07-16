import { PermissionService } from "../../02-application/auth/permission-service";
import {
  CreateClientUseCase,
  CreateHouseholdUseCase,
  GetClientDetailUseCase,
  ListClientsUseCase,
  ListHouseholdsUseCase,
  UpdateClientUseCase,
  UpdateHouseholdUseCase
} from "../../02-application/clients/use-cases/client-use-cases";
import { ClientController } from "../../03-adapters/controllers/ClientController";
import type { SharedContainer } from "./SharedContainer";

export function buildClientContainer(shared: SharedContainer) {
  const permissionService = new PermissionService(shared.identityStore, shared.identityStore);
  const listClientsUseCase = new ListClientsUseCase(shared.identityStore, permissionService);
  const createClientUseCase = new CreateClientUseCase(shared.identityStore, permissionService);
  const getClientDetailUseCase = new GetClientDetailUseCase(
    shared.identityStore,
    permissionService
  );
  const updateClientUseCase = new UpdateClientUseCase(shared.identityStore, permissionService);
  const listHouseholdsUseCase = new ListHouseholdsUseCase(
    shared.identityStore,
    permissionService
  );
  const createHouseholdUseCase = new CreateHouseholdUseCase(
    shared.identityStore,
    permissionService
  );
  const updateHouseholdUseCase = new UpdateHouseholdUseCase(
    shared.identityStore,
    permissionService
  );

  return {
    controller: new ClientController(
      listClientsUseCase,
      createClientUseCase,
      getClientDetailUseCase,
      updateClientUseCase,
      listHouseholdsUseCase,
      createHouseholdUseCase,
      updateHouseholdUseCase
    ),
    useCases: {
      listClientsUseCase,
      createClientUseCase,
      getClientDetailUseCase,
      updateClientUseCase,
      listHouseholdsUseCase,
      createHouseholdUseCase,
      updateHouseholdUseCase
    }
  };
}
