import { GetCurrentUserUseCase } from "../../02-application/users/use-cases/get-current-user-use-case";
import { UserController } from "../../03-adapters/controllers/UserController";
import { UserManagementController } from "../../03-adapters/controllers/UserManagementController";
import {
  CreateManagedUserUseCase,
  ListManagedUsersUseCase,
  UpdateManagedUserUseCase
} from "../../02-application/users/use-cases/user-management-use-cases";
import { SharedContainer } from "./SharedContainer";

export interface UserContainer {
  controller: UserController;
  managementController: UserManagementController;
  useCases: {
    getCurrentUserUseCase: GetCurrentUserUseCase;
    listManagedUsersUseCase: ListManagedUsersUseCase;
    createManagedUserUseCase: CreateManagedUserUseCase;
    updateManagedUserUseCase: UpdateManagedUserUseCase;
  };
}

export function buildUserContainer(shared: SharedContainer): UserContainer {
  const getCurrentUserUseCase = new GetCurrentUserUseCase(shared.identityStore);
  const common = {
    users: shared.identityStore,
    audits: shared.identityStore,
    events: {
      publishUserManagementEvent: async (
        topic: "user.created" | "user.updated" | "user.role_changed" | "user.status_changed",
        userId: string,
        payload: Record<string, string | number | boolean>
      ) => shared.identityStore.appendOutboxEvent(topic, userId, payload)
    },
    logger: shared.logger,
    metrics: shared.metrics
  };
  const listManagedUsersUseCase = new ListManagedUsersUseCase(common);
  const createManagedUserUseCase = new CreateManagedUserUseCase({
    ...common,
    passwordHasher: shared.passwordHasher
  });
  const updateManagedUserUseCase = new UpdateManagedUserUseCase({
    ...common,
    refreshTokens: shared.identityStore
  });
  const controller = new UserController(getCurrentUserUseCase);
  const managementController = new UserManagementController(
    listManagedUsersUseCase,
    createManagedUserUseCase,
    updateManagedUserUseCase
  );

  return {
    controller,
    managementController,
    useCases: {
      getCurrentUserUseCase,
      listManagedUsersUseCase,
      createManagedUserUseCase,
      updateManagedUserUseCase
    }
  };
}
