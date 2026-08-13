import { ClientSummary } from "../clients/client";
import { PortfolioSummary } from "../portfolios/portfolio";

export type ReviewItemSeverity = "low" | "medium" | "high";
export type ReviewItemStatus = "open" | "in_progress" | "closed";
export type ReviewResourceType =
  "client" | "portfolio" | "analytics" | "report" | "alert" | "notification";

export interface ReviewItem {
  id: string;
  officeId: string;
  title: string;
  severity: ReviewItemSeverity;
  status: ReviewItemStatus;
  resourceType: ReviewResourceType;
  resourceId: string;
  clientId?: string;
  portfolioId?: string;
  assignedToUserId?: string;
  dueDate?: string;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
}

export interface StaffWorkbench {
  officeId: string;
  generatedAt: Date;
  assignedClients: ClientSummary[];
  portfoliosNeedingAttention: PortfolioSummary[];
  reviewItems: ReviewItem[];
  counts: {
    assignedClients: number;
    portfoliosNeedingAttention: number;
    openReviewItems: number;
    highSeverityReviewItems: number;
    pendingReports: number;
    openAlerts: number;
  };
}
