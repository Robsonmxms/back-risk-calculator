import { Request, Response } from "express";
import {
  GetOfficeUseCase,
  ListOfficeMembersUseCase,
  ListOfficesUseCase,
  UpdateOfficeUseCase
} from "../../02-application/offices/use-cases/office-use-cases";
import {
  CreateAdvisoryTeamUseCase,
  CreateAssignmentUseCase,
  DeleteAssignmentUseCase,
  GetMyOfficePermissionsUseCase,
  ListAdvisoryTeamsUseCase,
  ListOfficeAssignmentsUseCase,
  UpdateAdvisoryTeamUseCase
} from "../../02-application/offices/use-cases/advisory-team-use-cases";
import { ApiError, ok } from "../http";
import { AuthenticatedRequest } from "../request";

export class OfficeController {
  constructor(
    private readonly listOfficesUseCase: ListOfficesUseCase,
    private readonly getOfficeUseCase: GetOfficeUseCase,
    private readonly listOfficeMembersUseCase: ListOfficeMembersUseCase,
    private readonly updateOfficeUseCase: UpdateOfficeUseCase,
    private readonly getMyOfficePermissionsUseCase: GetMyOfficePermissionsUseCase,
    private readonly listAdvisoryTeamsUseCase: ListAdvisoryTeamsUseCase,
    private readonly createAdvisoryTeamUseCase: CreateAdvisoryTeamUseCase,
    private readonly updateAdvisoryTeamUseCase: UpdateAdvisoryTeamUseCase,
    private readonly listOfficeAssignmentsUseCase: ListOfficeAssignmentsUseCase,
    private readonly createAssignmentUseCase: CreateAssignmentUseCase,
    private readonly deleteAssignmentUseCase: DeleteAssignmentUseCase
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

  getMyOfficePermissions = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const officeId = requireQueryOfficeId(request);
    const permissions = await this.getMyOfficePermissionsUseCase.execute(actor, officeId);
    return ok(response, {
      ...permissions,
      assignments: permissions.assignments.map(serializeAssignment)
    });
  };

  listTeams = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const teams = await this.listAdvisoryTeamsUseCase.execute(actor, requireOfficeId(request));
    return ok(response, { teams: teams.map(serializeTeam) }, { count: teams.length });
  };

  createTeam = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const team = await this.createAdvisoryTeamUseCase.execute(
      actor,
      requireOfficeId(request),
      request.body
    );
    return ok(response.status(201), serializeTeam(team));
  };

  updateTeam = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const team = await this.updateAdvisoryTeamUseCase.execute(
      actor,
      requireTeamId(request),
      request.body
    );
    return ok(response, serializeTeam(team));
  };

  listAssignments = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const assignments = await this.listOfficeAssignmentsUseCase.execute(
      actor,
      requireOfficeId(request)
    );
    return ok(
      response,
      { assignments: assignments.map(serializeAssignment) },
      { count: assignments.length }
    );
  };

  createAssignment = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const assignment = await this.createAssignmentUseCase.execute(
      actor,
      requireClientId(request),
      request.body
    );
    return ok(response.status(201), serializeAssignment(assignment));
  };

  deleteAssignment = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const assignment = await this.deleteAssignmentUseCase.execute(
      actor,
      requireAssignmentId(request)
    );
    return ok(response, serializeAssignment(assignment));
  };
}

function requireOfficeId(request: Request): string {
  const { officeId } = request.params;
  if (typeof officeId !== "string") {
    throw new ApiError(400, "request.invalid_office_id", "Invalid office id");
  }
  return officeId;
}

function requireTeamId(request: Request): string {
  const { teamId } = request.params;
  if (typeof teamId !== "string") {
    throw new ApiError(400, "request.invalid_team_id", "Invalid team id");
  }
  return teamId;
}

function requireClientId(request: Request): string {
  const { clientId } = request.params;
  if (typeof clientId !== "string") {
    throw new ApiError(400, "request.invalid_client_id", "Invalid client id");
  }
  return clientId;
}

function requireAssignmentId(request: Request): string {
  const { assignmentId } = request.params;
  if (typeof assignmentId !== "string") {
    throw new ApiError(400, "request.invalid_assignment_id", "Invalid assignment id");
  }
  return assignmentId;
}

function requireQueryOfficeId(request: Request): string {
  const { officeId } = request.query;
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

function serializeTeam(team: {
  id: string;
  officeId: string;
  name: string;
  description?: string;
  status: string;
  members: Array<{
    id: string;
    officeId: string;
    teamId: string;
    userId: string;
    userName: string;
    userEmail: string;
    role: string;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...team,
    members: team.members.map((member) => ({
      ...member,
      createdAt: member.createdAt.toISOString()
    })),
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString()
  };
}

function serializeAssignment(assignment: {
  id: string;
  officeId: string;
  resourceType: string;
  resourceId: string;
  assigneeUserId?: string;
  teamId?: string;
  permissions: string[];
  createdBy: string;
  createdAt: Date;
  revokedAt?: Date;
}) {
  return {
    ...assignment,
    createdAt: assignment.createdAt.toISOString(),
    revokedAt: assignment.revokedAt?.toISOString()
  };
}
