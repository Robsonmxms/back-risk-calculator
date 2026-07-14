import { ListUsersUseCase } from "../../02-application/users/use-cases/list-users-use-case";
import { AdminController } from "../../03-adapters/controllers/AdminController";
import { SharedContainer } from "./SharedContainer";

export interface AdminContainer {
  controller: AdminController;
  useCases: {
    listUsersUseCase: ListUsersUseCase;
  };
}

export function buildAdminContainer(shared: SharedContainer): AdminContainer {
  const listUsersUseCase = new ListUsersUseCase(shared.identityStore);
  const controller = new AdminController(listUsersUseCase);

  return {
    controller,
    useCases: {
      listUsersUseCase
    }
  };
}
