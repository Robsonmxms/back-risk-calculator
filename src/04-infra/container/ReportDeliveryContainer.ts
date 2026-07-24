import { PermissionService } from "../../02-application/auth/permission-service";
import {
  ApproveReportPackageUseCase,
  CreateReportPackageUseCase,
  DeliverReportPackageUseCase,
  GetClientPortalUseCase,
  GetReportPackageUseCase,
  ListClientReportPackagesUseCase,
  RevokeReportPackageUseCase,
  UpdateReportPackageUseCase
} from "../../02-application/delivery/use-cases/report-delivery-use-cases";
import { GetDeliveryChartsUseCase } from "../../02-application/compliance/use-cases/compliance-delivery-chart-use-cases";
import { ReportDeliveryController } from "../../03-adapters/controllers/ReportDeliveryController";
import {
  NotificationRepository,
  ReportRepository
} from "../../modules/reports-alerts/ports";
import type { SharedContainer } from "./SharedContainer";

export function buildReportDeliveryContainer(
  shared: SharedContainer,
  reports: ReportRepository,
  notifications: NotificationRepository
) {
  const permissionService = new PermissionService(shared.identityStore, shared.identityStore);
  const listClientReportPackagesUseCase = new ListClientReportPackagesUseCase(
    shared.identityStore,
    shared.identityStore,
    permissionService
  );
  const createReportPackageUseCase = new CreateReportPackageUseCase(
    shared.identityStore,
    shared.identityStore,
    reports,
    permissionService,
    shared.identityStore
  );
  const getReportPackageUseCase = new GetReportPackageUseCase(
    shared.identityStore,
    shared.identityStore,
    permissionService
  );
  const updateReportPackageUseCase = new UpdateReportPackageUseCase(
    shared.identityStore,
    shared.identityStore,
    permissionService
  );
  const approveReportPackageUseCase = new ApproveReportPackageUseCase(
    shared.identityStore,
    shared.identityStore,
    permissionService,
    shared.identityStore
  );
  const deliverReportPackageUseCase = new DeliverReportPackageUseCase(
    shared.identityStore,
    shared.identityStore,
    permissionService,
    shared.identityStore
  );
  const revokeReportPackageUseCase = new RevokeReportPackageUseCase(
    shared.identityStore,
    shared.identityStore,
    permissionService,
    shared.identityStore
  );
  const getClientPortalUseCase = new GetClientPortalUseCase(
    shared.identityStore,
    shared.identityStore,
    permissionService,
    shared.identityStore
  );
  const getDeliveryChartsUseCase = new GetDeliveryChartsUseCase(
    shared.identityStore,
    shared.identityStore,
    shared.identityStore,
    shared.identityStore,
    reports,
    notifications,
    shared.identityStore,
    permissionService,
    shared.logger,
    shared.metrics
  );

  return {
    controller: new ReportDeliveryController(
      listClientReportPackagesUseCase,
      createReportPackageUseCase,
      getReportPackageUseCase,
      updateReportPackageUseCase,
      approveReportPackageUseCase,
      deliverReportPackageUseCase,
      revokeReportPackageUseCase,
      getClientPortalUseCase,
      getDeliveryChartsUseCase
    ),
    useCases: {
      listClientReportPackagesUseCase,
      createReportPackageUseCase,
      getReportPackageUseCase,
      updateReportPackageUseCase,
      approveReportPackageUseCase,
      deliverReportPackageUseCase,
      revokeReportPackageUseCase,
      getClientPortalUseCase,
      getDeliveryChartsUseCase
    }
  };
}
