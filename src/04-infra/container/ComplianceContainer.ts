import { PermissionService } from "../../02-application/auth/permission-service";
import {
  GetAuditEventUseCase,
  ListAuditEventsUseCase,
  ListSupervisionReviewsUseCase,
  RequestAuditExportUseCase,
  UpdateSupervisionReviewUseCase
} from "../../02-application/compliance/use-cases/compliance-use-cases";
import { ComplianceController } from "../../03-adapters/controllers/ComplianceController";
import type { SharedContainer } from "./SharedContainer";

export function buildComplianceContainer(shared: SharedContainer) {
  const permissionService = new PermissionService(shared.identityStore, shared.identityStore);
  const listAuditEventsUseCase = new ListAuditEventsUseCase(
    shared.identityStore,
    permissionService
  );
  const getAuditEventUseCase = new GetAuditEventUseCase(
    shared.identityStore,
    permissionService
  );
  const listSupervisionReviewsUseCase = new ListSupervisionReviewsUseCase(
    shared.identityStore,
    permissionService
  );
  const updateSupervisionReviewUseCase = new UpdateSupervisionReviewUseCase(
    shared.identityStore,
    permissionService,
    shared.metrics
  );
  const requestAuditExportUseCase = new RequestAuditExportUseCase(
    shared.identityStore,
    permissionService,
    shared.metrics
  );

  return {
    controller: new ComplianceController(
      listAuditEventsUseCase,
      getAuditEventUseCase,
      listSupervisionReviewsUseCase,
      updateSupervisionReviewUseCase,
      requestAuditExportUseCase
    ),
    useCases: {
      listAuditEventsUseCase,
      getAuditEventUseCase,
      listSupervisionReviewsUseCase,
      updateSupervisionReviewUseCase,
      requestAuditExportUseCase
    }
  };
}
