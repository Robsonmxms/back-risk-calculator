import {
  AdvisoryAssignment,
  AssignmentResourceType,
  PermissionKey
} from "../../01-domain/advisory/advisory-team";
import { Actor } from "../../01-domain/auth/actor";
import { OfficeMembershipRole } from "../../01-domain/offices/office";
import { ApplicationError } from "../errors/application-error";
import { AdvisoryTeamRepository, OfficeRepository } from "../ports/repositories";

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
  "client.read",
  "client.manage",
  "ledger.read",
  "ledger.write",
  "analytics.read",
  "analytics.recompute",
  "reports.request",
  "reports.approve",
  "alerts.manage",
  "notifications.read",
  "office.members.manage",
  "audit.read"
];

export const ROLE_PERMISSION_MATRIX: Record<OfficeMembershipRole, PermissionKey[]> = {
  office_admin: ALL_PERMISSION_KEYS,
  advisor: [
    "client.read",
    "client.manage",
    "reports.request",
    "alerts.manage",
    "notifications.read"
  ],
  analyst: [
    "client.read",
    "analytics.recompute",
    "reports.request",
    "notifications.read"
  ],
  assistant: ["client.read", "reports.request", "alerts.manage", "notifications.read"],
  client: ["notifications.read"]
};

export interface PermissionResourceScope {
  resourceType: AssignmentResourceType;
  resourceId: string;
}

export interface PermissionEvaluation {
  officeId: string;
  role: OfficeMembershipRole;
  permissions: PermissionKey[];
  assignments: AdvisoryAssignment[];
  matrix: Record<OfficeMembershipRole, PermissionKey[]>;
}

export function getDefaultPermissionsForRole(role: OfficeMembershipRole): PermissionKey[] {
  return [...ROLE_PERMISSION_MATRIX[role]];
}

export function actorHasDefaultOfficePermission(
  actor: Actor,
  officeId: string,
  permission: PermissionKey
): boolean {
  if (actor.role === "admin") {
    return true;
  }

  const membership = actor.officeMemberships.find((entry) => entry.officeId === officeId);
  if (!membership) {
    return false;
  }

  return ROLE_PERMISSION_MATRIX[membership.role].includes(permission);
}

export class PermissionService {
  constructor(
    private readonly offices: OfficeRepository,
    private readonly advisory: AdvisoryTeamRepository
  ) {}

  async evaluate(actor: Actor, officeId: string): Promise<PermissionEvaluation> {
    const office = await this.offices.findOfficeById(officeId);
    if (!office) {
      throw new ApplicationError("not_found", "office.not_found", "Office not found");
    }

    const membership =
      actor.role === "admin"
        ? ({ role: "office_admin" as const })
        : await this.offices.findOfficeMembership(officeId, actor.id);
    if (!membership) {
      throw new ApplicationError(
        "forbidden",
        "auth.office_access_denied",
        "Office access denied"
      );
    }

    const assignments = await this.advisory.listAssignmentsForUser(actor.id, officeId);
    const permissions = new Set<PermissionKey>(ROLE_PERMISSION_MATRIX[membership.role]);
    for (const assignment of assignments) {
      if (!assignment.revokedAt) {
        for (const permission of assignment.permissions) {
          permissions.add(permission);
        }
      }
    }

    return {
      officeId,
      role: membership.role,
      permissions: Array.from(permissions).sort(),
      assignments,
      matrix: ROLE_PERMISSION_MATRIX
    };
  }

  async assertPermission(
    actor: Actor,
    officeId: string,
    permission: PermissionKey,
    resource?: PermissionResourceScope
  ): Promise<PermissionEvaluation> {
    const evaluation = await this.evaluate(actor, officeId);

    if (ROLE_PERMISSION_MATRIX[evaluation.role].includes(permission)) {
      return evaluation;
    }

    if (
      resource &&
      evaluation.assignments.some(
        (assignment) =>
          !assignment.revokedAt &&
          assignment.resourceType === resource.resourceType &&
          assignment.resourceId === resource.resourceId &&
          assignment.permissions.includes(permission)
      )
    ) {
      return evaluation;
    }

    throw new ApplicationError(
      "forbidden",
      "auth.permission_denied",
      `Permission ${permission} is required`
    );
  }
}
