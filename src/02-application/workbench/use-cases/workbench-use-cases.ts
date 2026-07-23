import { randomUUID } from "crypto";
import { Actor } from "../../../01-domain/auth/actor";
import {
  ReviewItem,
  ReviewItemSeverity,
  ReviewItemStatus,
  ReviewResourceType,
  StaffWorkbench
} from "../../../01-domain/workbench/workbench";
import {
  PermissionEvaluation,
  ROLE_PERMISSION_MATRIX,
  PermissionService
} from "../../auth/permission-service";
import { ApplicationError } from "../../errors/application-error";
import {
  ClientRepository,
  PortfolioRepository,
  ReviewItemFilters,
  WorkbenchRepository
} from "../../ports/repositories";

function visibleClientIdsFromAssignments(assignments: Array<{ resourceType: string; resourceId: string; permissions: string[]; revokedAt?: Date }>) {
  return new Set(
    assignments
      .filter(
        (assignment) =>
          !assignment.revokedAt &&
          assignment.resourceType === "client" &&
          assignment.permissions.includes("client.read")
      )
      .map((assignment) => assignment.resourceId)
  );
}

export class GetWorkbenchUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly workbench: WorkbenchRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor, officeId: string): Promise<StaffWorkbench> {
    const evaluation = await this.permissions.evaluate(actor, officeId);
    assertStaffWorkbenchAccess(evaluation);
    const canReadOffice = ROLE_PERMISSION_MATRIX[evaluation.role].includes("client.read");
    const visibleClientIds = canReadOffice
      ? undefined
      : visibleClientIdsFromAssignments(evaluation.assignments);
    const assignedClients = await this.clients.listClients(officeId, {}, visibleClientIds);
    const reviewItems = await this.workbench.listReviewItems(officeId, {}, visibleClientIds);
    const portfoliosById = new Map(
      (
        await Promise.all(
          assignedClients.map(async (client) => {
            const detail = await this.clients.findClientById(client.id);
            return detail?.portfolios ?? [];
          })
        )
      )
        .flat()
        .map((portfolio) => [portfolio.id, portfolio])
    );

    for (const portfolio of await this.portfolios.listVisiblePortfolios(
      actor.id,
      actor.role === "admin"
    )) {
      if (portfolio.officeId === officeId) {
        portfoliosById.set(portfolio.id, portfolio);
      }
    }

    const portfoliosNeedingAttention = Array.from(portfoliosById.values()).filter(
      (portfolio) =>
        portfolio.status !== "ready" ||
        portfolio.freshness !== "fresh" ||
        portfolio.analyticsState !== "ready" ||
        portfolio.marketDataState !== "ready"
    );

    return {
      officeId,
      generatedAt: this.now(),
      assignedClients,
      portfoliosNeedingAttention,
      reviewItems,
      counts: {
        assignedClients: assignedClients.length,
        portfoliosNeedingAttention: portfoliosNeedingAttention.length,
        openReviewItems: reviewItems.filter((item) => item.status !== "closed").length,
        highSeverityReviewItems: reviewItems.filter(
          (item) => item.status !== "closed" && item.severity === "high"
        ).length,
        pendingReports: portfoliosNeedingAttention.filter(
          (portfolio) => portfolio.marketDataState === "pending"
        ).length,
        openAlerts: reviewItems.filter((item) => item.resourceType === "alert").length
      }
    };
  }
}

export class ListReviewItemsUseCase {
  constructor(
    private readonly workbench: WorkbenchRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(actor: Actor, officeId: string, filters: ReviewItemFilters): Promise<ReviewItem[]> {
    const evaluation = await this.permissions.evaluate(actor, officeId);
    assertStaffWorkbenchAccess(evaluation);
    const canReadOffice = ROLE_PERMISSION_MATRIX[evaluation.role].includes("client.read");
    return this.workbench.listReviewItems(
      officeId,
      filters,
      canReadOffice ? undefined : visibleClientIdsFromAssignments(evaluation.assignments)
    );
  }
}

export class CreateReviewItemUseCase {
  constructor(
    private readonly workbench: WorkbenchRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    input: {
      title: string;
      severity: ReviewItemSeverity;
      resourceType: ReviewResourceType;
      resourceId: string;
      clientId?: string;
      portfolioId?: string;
      assignedToUserId?: string;
      dueDate?: string;
      notes?: string;
    }
  ): Promise<ReviewItem> {
    const evaluation = await this.permissions.assertPermission(actor, officeId, "client.read");
    assertStaffWorkbenchAccess(evaluation);
    const createdAt = this.now();
    return this.workbench.createReviewItem({
      id: randomUUID(),
      officeId,
      title: input.title.trim(),
      severity: input.severity,
      status: "open",
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      clientId: input.clientId,
      portfolioId: input.portfolioId,
      assignedToUserId: input.assignedToUserId,
      dueDate: input.dueDate,
      notes: input.notes?.trim() || undefined,
      createdBy: actor.id,
      createdAt,
      updatedAt: createdAt
    });
  }
}

export class UpdateReviewItemUseCase {
  constructor(
    private readonly workbench: WorkbenchRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    reviewItemId: string,
    input: Partial<{
      title: string;
      severity: ReviewItemSeverity;
      status: ReviewItemStatus;
      assignedToUserId: string;
      dueDate: string;
      notes: string;
    }>
  ): Promise<ReviewItem> {
    const item = await this.workbench.findReviewItemById(reviewItemId);
    if (!item) {
      throw new ApplicationError("not_found", "review_item.not_found", "Review item not found");
    }

    const evaluation = await this.permissions.assertPermission(actor, item.officeId, "client.read");
    assertStaffWorkbenchAccess(evaluation);
    const updated = await this.workbench.updateReviewItem(reviewItemId, {
      title: input.title?.trim(),
      severity: input.severity,
      status: input.status,
      assignedToUserId: input.assignedToUserId,
      dueDate: input.dueDate,
      notes: input.notes?.trim(),
      updatedAt: this.now(),
      closedAt: input.status === "closed" ? this.now() : undefined
    });
    if (!updated) {
      throw new ApplicationError("not_found", "review_item.not_found", "Review item not found");
    }
    return updated;
  }
}

function assertStaffWorkbenchAccess(evaluation: PermissionEvaluation): void {
  if (evaluation.role !== "client") {
    return;
  }

  throw new ApplicationError(
    "forbidden",
    "auth.permission_denied",
    "Staff workbench access is restricted"
  );
}
