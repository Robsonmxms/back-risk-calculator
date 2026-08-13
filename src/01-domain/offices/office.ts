export type OfficeStatus = "active" | "disabled";
export type OfficeMembershipRole = "office_admin" | "advisor" | "analyst" | "assistant" | "client";

export interface Office {
  id: string;
  name: string;
  status: OfficeStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface OfficeMembership {
  id: string;
  officeId: string;
  userId: string;
  role: OfficeMembershipRole;
  createdAt: Date;
}

export interface OfficeMembershipSummary {
  officeId: string;
  officeName: string;
  role: OfficeMembershipRole;
}
