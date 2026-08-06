import { randomUUID } from "crypto";
import {
  AdvisoryAssignment,
  AdvisoryTeamSummary,
  AssignmentResourceType,
  PermissionKey
} from "../../../01-domain/advisory/advisory-team";
import { Actor } from "../../../01-domain/auth/actor";
import { ApplicationError } from "../../errors/application-error";
import { AdvisoryTeamRepository } from "../../ports/repositories";
import { PermissionEvaluation, PermissionService } from "../../auth/permission-service";

export class GetMyOfficePermissionsUseCase {
  constructor(private readonly permissions: PermissionService) {}

  async execute(actor: Actor, officeId: string): Promise<PermissionEvaluation> {
    return this.permissions.evaluate(actor, officeId);
  }
}

export class ListAdvisoryTeamsUseCase {
  constructor(
    private readonly advisory: AdvisoryTeamRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(actor: Actor, officeId: string): Promise<AdvisoryTeamSummary[]> {
    await this.permissions.assertPermission(actor, officeId, "office.members.manage");
    return this.advisory.listTeamsByOffice(officeId);
  }
}

export class CreateAdvisoryTeamUseCase {
  constructor(
    private readonly advisory: AdvisoryTeamRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    input: { name: string; description?: string; memberUserIds?: string[] }
  ): Promise<AdvisoryTeamSummary> {
    await this.permissions.assertPermission(actor, officeId, "office.members.manage");
    const createdAt = this.now();
    return this.advisory.createTeam({
      id: randomUUID(),
      officeId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      memberUserIds: input.memberUserIds ?? [],
      createdAt,
      updatedAt: createdAt
    });
  }
}

export class UpdateAdvisoryTeamUseCase {
  constructor(
    private readonly advisory: AdvisoryTeamRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    teamId: string,
    input: {
      name?: string;
      description?: string;
      status?: "active" | "archived";
      memberUserIds?: string[];
    }
  ): Promise<AdvisoryTeamSummary> {
    const team = await this.advisory.findTeamById(teamId);
    if (!team) {
      throw new ApplicationError("not_found", "team.not_found", "Team not found");
    }

    await this.permissions.assertPermission(actor, team.officeId, "office.members.manage");
    const updated = await this.advisory.updateTeam(teamId, {
      name: input.name?.trim(),
      description: input.description?.trim() || undefined,
      status: input.status,
      memberUserIds: input.memberUserIds,
      updatedAt: this.now()
    });
    if (!updated) {
      throw new ApplicationError("not_found", "team.not_found", "Team not found");
    }
    return updated;
  }
}

export class ListOfficeAssignmentsUseCase {
  constructor(
    private readonly advisory: AdvisoryTeamRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(actor: Actor, officeId: string): Promise<AdvisoryAssignment[]> {
    await this.permissions.assertPermission(actor, officeId, "office.members.manage");
    return this.advisory.listAssignmentsByOffice(officeId);
  }
}

export class CreateAssignmentUseCase {
  constructor(
    private readonly advisory: AdvisoryTeamRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    clientId: string,
    input: {
      officeId: string;
      assigneeUserId?: string;
      teamId?: string;
      resourceType?: AssignmentResourceType;
      resourceId?: string;
      permissions: PermissionKey[];
    }
  ): Promise<AdvisoryAssignment> {
    await this.permissions.assertPermission(actor, input.officeId, "office.members.manage");
    if (!input.assigneeUserId && !input.teamId) {
      throw new ApplicationError(
        "invalid",
        "assignment.assignee_required",
        "Assignment requires a user or team"
      );
    }

    return this.advisory.createAssignment({
      id: randomUUID(),
      officeId: input.officeId,
      resourceType: input.resourceType ?? "client",
      resourceId: input.resourceId ?? clientId,
      assigneeUserId: input.assigneeUserId,
      teamId: input.teamId,
      permissions: input.permissions,
      createdBy: actor.id,
      createdAt: this.now()
    });
  }
}

export class DeleteAssignmentUseCase {
  constructor(
    private readonly advisory: AdvisoryTeamRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor, assignmentId: string): Promise<AdvisoryAssignment> {
    const assignment = await this.advisory.findAssignmentById(assignmentId);
    if (!assignment) {
      throw new ApplicationError("not_found", "assignment.not_found", "Assignment not found");
    }

    await this.permissions.assertPermission(actor, assignment.officeId, "office.members.manage");
    const revoked = await this.advisory.revokeAssignment(assignmentId, this.now());
    if (!revoked) {
      throw new ApplicationError("not_found", "assignment.not_found", "Assignment not found");
    }
    return revoked;
  }
}
