import { UserManagementAuditEvent } from "../../01-domain/users/user-management-audit";

export interface UserManagementAuditPort {
  recordUserManagementAudit(event: UserManagementAuditEvent): Promise<void>;
}

export interface UserManagementEventPublisher {
  publishUserManagementEvent(
    topic: "user.created" | "user.updated" | "user.role_changed" | "user.status_changed",
    userId: string,
    payload: Record<string, string | number | boolean>
  ): Promise<void>;
}
