import { UserRole, UserStatus } from "./user";

export type UserManagementAction = "list" | "create" | "update";
export type UserManagementOutcome = "success" | "denied" | "conflict" | "not_found";

export interface UserManagementAuditEvent {
  id: string;
  correlationId: string;
  actorId: string;
  actorRole: UserRole;
  targetId?: string;
  targetRole?: UserRole;
  resultingRole?: UserRole;
  previousStatus?: UserStatus;
  resultingStatus?: UserStatus;
  changedFields: string[];
  action: UserManagementAction;
  outcome: UserManagementOutcome;
  reasonCode: string;
  createdAt: Date;
}
