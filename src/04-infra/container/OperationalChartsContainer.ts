import { PermissionService } from "../../02-application/auth/permission-service";
import {
  GetOfficeAdminChartsUseCase,
  GetPlatformAdminChartsUseCase
} from "../../02-application/offices/use-cases/operational-chart-use-cases";
import { OperationalChartsController } from "../../03-adapters/controllers/OperationalChartsController";
import type { AnalyticsRepository } from "../../modules/analytics/ports";
import type { MarketDataJobQueue, MarketDataRepository } from "../../modules/market-data/ports";
import type {
  AlertRepository,
  NotificationRepository,
  ReportRepository
} from "../../modules/reports-alerts/ports";
import type { SharedContainer } from "./SharedContainer";

export interface OperationalChartsContainerDependencies {
  analyticsRepository: AnalyticsRepository;
  marketDataRepository: MarketDataRepository;
  marketDataJobQueue: MarketDataJobQueue;
  reportRepository: ReportRepository;
  alertRepository: AlertRepository;
  notificationRepository: NotificationRepository;
  operationalChartsNow?: () => Date;
}

export function buildOperationalChartsContainer(
  shared: SharedContainer,
  dependencies: OperationalChartsContainerDependencies
) {
  const now = dependencies.operationalChartsNow ?? (() => new Date());
  const permissionService = new PermissionService(shared.identityStore, shared.identityStore);
  const getOfficeAdminChartsUseCase = new GetOfficeAdminChartsUseCase(
    shared.identityStore,
    shared.identityStore,
    shared.identityStore,
    shared.identityStore,
    dependencies.analyticsRepository,
    dependencies.marketDataRepository,
    dependencies.marketDataJobQueue,
    dependencies.reportRepository,
    shared.identityStore,
    dependencies.alertRepository,
    dependencies.notificationRepository,
    shared.identityStore,
    permissionService,
    shared.logger,
    shared.metrics,
    now
  );
  const getPlatformAdminChartsUseCase = new GetPlatformAdminChartsUseCase(
    getOfficeAdminChartsUseCase,
    shared.identityStore,
    shared.logger,
    shared.metrics,
    now
  );

  return {
    controller: new OperationalChartsController(
      getOfficeAdminChartsUseCase,
      getPlatformAdminChartsUseCase
    ),
    useCases: {
      getOfficeAdminChartsUseCase,
      getPlatformAdminChartsUseCase
    }
  };
}
