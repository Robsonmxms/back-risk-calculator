import { OfficeController } from "../../03-adapters/controllers/OfficeController";
import { PermissionService } from "../../02-application/auth/permission-service";
import {
  CreateAdvisoryTeamUseCase,
  CreateAssignmentUseCase,
  DeleteAssignmentUseCase,
  GetMyOfficePermissionsUseCase,
  ListAdvisoryTeamsUseCase,
  ListOfficeAssignmentsUseCase,
  UpdateAdvisoryTeamUseCase
} from "../../02-application/offices/use-cases/advisory-team-use-cases";
import {
  GetOfficeUseCase,
  ListOfficeMembersUseCase,
  ListOfficesUseCase,
  UpdateOfficeUseCase
} from "../../02-application/offices/use-cases/office-use-cases";
import type { SharedContainer } from "./SharedContainer";

export function buildOfficeContainer(shared: SharedContainer) {
  const permissionService = new PermissionService(shared.identityStore, shared.identityStore);
  const listOfficesUseCase = new ListOfficesUseCase(shared.identityStore);
  const getOfficeUseCase = new GetOfficeUseCase(shared.identityStore);
  const listOfficeMembersUseCase = new ListOfficeMembersUseCase(shared.identityStore);
  const updateOfficeUseCase = new UpdateOfficeUseCase(shared.identityStore);
  const getMyOfficePermissionsUseCase = new GetMyOfficePermissionsUseCase(permissionService);
  const listAdvisoryTeamsUseCase = new ListAdvisoryTeamsUseCase(
    shared.identityStore,
    permissionService
  );
  const createAdvisoryTeamUseCase = new CreateAdvisoryTeamUseCase(
    shared.identityStore,
    permissionService
  );
  const updateAdvisoryTeamUseCase = new UpdateAdvisoryTeamUseCase(
    shared.identityStore,
    permissionService
  );
  const listOfficeAssignmentsUseCase = new ListOfficeAssignmentsUseCase(
    shared.identityStore,
    permissionService
  );
  const createAssignmentUseCase = new CreateAssignmentUseCase(
    shared.identityStore,
    permissionService
  );
  const deleteAssignmentUseCase = new DeleteAssignmentUseCase(
    shared.identityStore,
    permissionService
  );

  return {
    controller: new OfficeController(
      listOfficesUseCase,
      getOfficeUseCase,
      listOfficeMembersUseCase,
      updateOfficeUseCase,
      getMyOfficePermissionsUseCase,
      listAdvisoryTeamsUseCase,
      createAdvisoryTeamUseCase,
      updateAdvisoryTeamUseCase,
      listOfficeAssignmentsUseCase,
      createAssignmentUseCase,
      deleteAssignmentUseCase
    ),
    useCases: {
      listOfficesUseCase,
      getOfficeUseCase,
      listOfficeMembersUseCase,
      updateOfficeUseCase,
      getMyOfficePermissionsUseCase,
      listAdvisoryTeamsUseCase,
      createAdvisoryTeamUseCase,
      updateAdvisoryTeamUseCase,
      listOfficeAssignmentsUseCase,
      createAssignmentUseCase,
      deleteAssignmentUseCase
    }
  };
}
