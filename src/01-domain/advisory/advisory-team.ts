import { OfficeMembershipRole } from "../offices/office";

export type PermissionKey =
  | "client.read"
  | "client.manage"
  | "ledger.read"
  | "ledger.write"
  | "analytics.read"
  | "analytics.recompute"
  | "reports.request"
  | "reports.approve"
  | "alerts.manage"
  | "notifications.read"
  | "office.members.manage"
  | "audit.read";

export type AssignmentResourceType = "client" | "household" | "account" | "portfolio";

export interface AdvisoryTeam {
  id: string;
  officeId: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

export interface AdvisoryTeamMember {
  id: string;
  officeId: string;
  teamId: string;
  userId: string;
  role: OfficeMembershipRole;
  createdAt: Date;
}

export interface AdvisoryTeamSummary extends AdvisoryTeam {
  members: Array<AdvisoryTeamMember & {
    userName: string;
    userEmail: string;
  }>;
}

export interface AdvisoryAssignment {
  id: string;
  officeId: string;
  resourceType: AssignmentResourceType;
  resourceId: string;
  assigneeUserId?: string;
  teamId?: string;
  permissions: PermissionKey[];
  createdBy: string;
  createdAt: Date;
  revokedAt?: Date;
}
