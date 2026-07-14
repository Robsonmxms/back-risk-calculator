export type AccountMemberRole = "owner" | "analyst" | "viewer";

export interface Account {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountMember {
  id: string;
  accountId: string;
  userId: string;
  role: AccountMemberRole;
  createdAt: Date;
}

export interface AccountMembershipSummary {
  accountId: string;
  accountName: string;
  role: AccountMemberRole;
}
