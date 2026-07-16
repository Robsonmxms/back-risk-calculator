import { PortfolioSummary } from "../portfolios/portfolio";

export type ReportPackageStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "delivered"
  | "viewed"
  | "revoked";

export type ReportPackageItemType = "report" | "analytics_snapshot" | "portfolio_summary";
export type ReportPackageItemStatus = "ready" | "pending" | "unavailable";

export interface ReportPackageItem {
  id: string;
  type: ReportPackageItemType;
  title: string;
  portfolioId?: string;
  reportId?: string;
  analyticsSnapshotId?: string;
  format?: "pdf" | "csv" | "json";
  status: ReportPackageItemStatus;
}

export interface ReportPackage {
  id: string;
  officeId: string;
  clientId: string;
  householdId?: string;
  title: string;
  summaryNotes: string;
  internalNotes?: string;
  status: ReportPackageStatus;
  items: ReportPackageItem[];
  createdBy: string;
  approvedBy?: string;
  deliveredBy?: string;
  viewedBy?: string;
  revokedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
  deliveredAt?: Date;
  viewedAt?: Date;
  revokedAt?: Date;
}

export interface ClientPortalPackage {
  id: string;
  officeId: string;
  clientId: string;
  householdId?: string;
  title: string;
  summaryNotes: string;
  status: Extract<ReportPackageStatus, "delivered" | "viewed">;
  items: ReportPackageItem[];
  deliveredAt?: Date;
  viewedAt?: Date;
  portfolios: PortfolioSummary[];
}

export interface ClientPortalReadModel {
  actorId: string;
  generatedAt: Date;
  clients: Array<{
    id: string;
    officeId: string;
    name: string;
    householdName?: string;
  }>;
  packages: ClientPortalPackage[];
}
