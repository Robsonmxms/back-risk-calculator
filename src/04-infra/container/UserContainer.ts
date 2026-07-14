import { GetCurrentUserUseCase } from "../../02-application/users/use-cases/get-current-user-use-case";
import { UserController } from "../../03-adapters/controllers/UserController";
import { SharedContainer } from "./SharedContainer";

export interface UserContainer {
  controller: UserController;
  useCases: {
    getCurrentUserUseCase: GetCurrentUserUseCase;
  };
}

export function buildUserContainer(shared: SharedContainer): UserContainer {
  const getCurrentUserUseCase = new GetCurrentUserUseCase(shared.identityStore);
  const controller = new UserController(getCurrentUserUseCase);

  return {
    controller,
    useCases: {
      getCurrentUserUseCase
    }
  };
}
