import { Request, Response } from "express";
import {
  GetOfficeUseCase,
  ListOfficeMembersUseCase,
  ListOfficesUseCase,
  UpdateOfficeUseCase
} from "../../02-application/offices/use-cases/office-use-cases";
import { ApiError, ok } from "../http";
import { AuthenticatedRequest } from "../request";

export class OfficeController {
  constructor(
    private readonly listOfficesUseCase: ListOfficesUseCase,
    private readonly getOfficeUseCase: GetOfficeUseCase,
    private readonly listOfficeMembersUseCase: ListOfficeMembersUseCase,
    private readonly updateOfficeUseCase: UpdateOfficeUseCase
  ) {}

  listOffices = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const offices = await this.listOfficesUseCase.execute(actor);
    return ok(response, { offices }, { count: offices.length });
  };

  getOffice = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const office = await this.getOfficeUseCase.execute(actor, requireOfficeId(request));
    return ok(response, serializeOffice(office));
  };

  listOfficeMembers = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const members = await this.listOfficeMembersUseCase.execute(actor, requireOfficeId(request));
    return ok(response, { members: members.map(serializeOfficeMember) }, { count: members.length });
  };

  updateOffice = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const office = await this.updateOfficeUseCase.execute(
      actor,
      requireOfficeId(request),
      request.body
    );
    return ok(response, serializeOffice(office));
  };
}

function requireOfficeId(request: Request): string {
  const { officeId } = request.params;
  if (typeof officeId !== "string") {
    throw new ApiError(400, "request.invalid_office_id", "Invalid office id");
  }
  return officeId;
}

function serializeOffice(office: { id: string; name: string; status: string; createdAt: Date; updatedAt: Date }) {
  return {
    ...office,
    createdAt: office.createdAt.toISOString(),
    updatedAt: office.updatedAt.toISOString()
  };
}

function serializeOfficeMember(member: {
  id: string;
  officeId: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: string;
  createdAt: Date;
}) {
  return {
    ...member,
    createdAt: member.createdAt.toISOString()
  };
}
