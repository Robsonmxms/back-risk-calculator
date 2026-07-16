import { OfficeController } from "../../03-adapters/controllers/OfficeController";
import {
  GetOfficeUseCase,
  ListOfficeMembersUseCase,
  ListOfficesUseCase,
  UpdateOfficeUseCase
} from "../../02-application/offices/use-cases/office-use-cases";
import type { SharedContainer } from "./SharedContainer";

export function buildOfficeContainer(shared: SharedContainer) {
  const listOfficesUseCase = new ListOfficesUseCase(shared.identityStore);
  const getOfficeUseCase = new GetOfficeUseCase(shared.identityStore);
  const listOfficeMembersUseCase = new ListOfficeMembersUseCase(shared.identityStore);
  const updateOfficeUseCase = new UpdateOfficeUseCase(shared.identityStore);

  return {
    controller: new OfficeController(
      listOfficesUseCase,
      getOfficeUseCase,
      listOfficeMembersUseCase,
      updateOfficeUseCase
    ),
    useCases: {
      listOfficesUseCase,
      getOfficeUseCase,
      listOfficeMembersUseCase,
      updateOfficeUseCase
    }
  };
}
