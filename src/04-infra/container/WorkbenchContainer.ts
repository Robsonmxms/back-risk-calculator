import { PermissionService } from "../../02-application/auth/permission-service";
import { GetAdvisorChartsUseCase } from "../../02-application/workbench/use-cases/advisor-chart-use-case";
import {
  CreateReviewItemUseCase,
  GetWorkbenchUseCase,
  ListReviewItemsUseCase,
  UpdateReviewItemUseCase
} from "../../02-application/workbench/use-cases/workbench-use-cases";
import { WorkbenchController } from "../../03-adapters/controllers/WorkbenchController";
import { AnalyticsRepository } from "../../modules/analytics/ports";
import { AlertRepository } from "../../modules/reports-alerts/ports";
import type { SharedContainer } from "./SharedContainer";

export interface WorkbenchContainerDependencies {
  analyticsRepository: AnalyticsRepository;
  alertRepository: AlertRepository;
  workbenchNow?: () => Date;
}

export function buildWorkbenchContainer(
  shared: SharedContainer,
  dependencies: WorkbenchContainerDependencies
) {
  const permissionService = new PermissionService(shared.identityStore, shared.identityStore);
  const now = dependencies.workbenchNow ?? (() => new Date());
  const getAdvisorChartsUseCase = new GetAdvisorChartsUseCase(
    shared.identityStore,
    shared.identityStore,
    shared.identityStore,
    shared.identityStore,
    shared.identityStore,
    shared.identityStore,
    dependencies.analyticsRepository,
    dependencies.alertRepository,
    permissionService,
    shared.logger,
    shared.metrics,
    now
  );
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
      getAdvisorChartsUseCase,
      getWorkbenchUseCase,
      listReviewItemsUseCase,
      createReviewItemUseCase,
      updateReviewItemUseCase
    ),
    useCases: {
      getAdvisorChartsUseCase,
      getWorkbenchUseCase,
      listReviewItemsUseCase,
      createReviewItemUseCase,
      updateReviewItemUseCase
    }
  };
}
