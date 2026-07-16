import { PermissionService } from "../../02-application/auth/permission-service";
import {
  CreateReviewItemUseCase,
  GetWorkbenchUseCase,
  ListReviewItemsUseCase,
  UpdateReviewItemUseCase
} from "../../02-application/workbench/use-cases/workbench-use-cases";
import { WorkbenchController } from "../../03-adapters/controllers/WorkbenchController";
import type { SharedContainer } from "./SharedContainer";

export function buildWorkbenchContainer(shared: SharedContainer) {
  const permissionService = new PermissionService(shared.identityStore, shared.identityStore);
  const getWorkbenchUseCase = new GetWorkbenchUseCase(
    shared.identityStore,
    shared.identityStore,
    shared.identityStore,
    permissionService
  );
  const listReviewItemsUseCase = new ListReviewItemsUseCase(
    shared.identityStore,
    permissionService
  );
  const createReviewItemUseCase = new CreateReviewItemUseCase(
    shared.identityStore,
    permissionService
  );
  const updateReviewItemUseCase = new UpdateReviewItemUseCase(
    shared.identityStore,
    permissionService
  );

  return {
    controller: new WorkbenchController(
      getWorkbenchUseCase,
      listReviewItemsUseCase,
      createReviewItemUseCase,
      updateReviewItemUseCase
    ),
    useCases: {
      getWorkbenchUseCase,
      listReviewItemsUseCase,
      createReviewItemUseCase,
      updateReviewItemUseCase
    }
  };
}
