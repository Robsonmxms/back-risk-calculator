import { randomUUID } from "crypto";
import { Actor } from "../../../01-domain/auth/actor";
import {
  AuditEvent,
  AuditExportFormat,
  AuditExportJob,
  SafeAuditMetadata,
  SafeAuditMetadataValue,
  SupervisionReview,
  SupervisionReviewStatus
} from "../../../01-domain/compliance/audit";
import { PermissionService } from "../../auth/permission-service";
import { ApplicationError } from "../../errors/application-error";
import { MetricsPort } from "../../ports/observability";
import {
  AuditEventFilters,
  AuditEventPage,
  AuditRepository,
  SupervisionReviewFilters
} from "../../ports/repositories";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export class ListAuditEventsUseCase {
  constructor(
    private readonly audits: AuditRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    filters: AuditEventFilters
  ): Promise<AuditEventPage> {
    await this.permissions.assertPermission(actor, officeId, "audit.read");
    return this.audits.listAuditEvents(officeId, normalizeAuditFilters(filters));
  }
}

export class GetAuditEventUseCase {
  constructor(
    private readonly audits: AuditRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(actor: Actor, auditEventId: string): Promise<AuditEvent> {
    const event = await this.audits.findAuditEventById(auditEventId);
    if (!event) {
      throw new ApplicationError("not_found", "audit_event.not_found", "Audit event not found");
    }

    await this.permissions.assertPermission(actor, event.officeId, "audit.read");
    return event;
  }
}

export class ListSupervisionReviewsUseCase {
  constructor(
    private readonly audits: AuditRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    filters: SupervisionReviewFilters
  ): Promise<SupervisionReview[]> {
    await this.permissions.assertPermission(actor, officeId, "audit.read");
    return this.audits.listSupervisionReviews(officeId, filters);
  }
}

export class UpdateSupervisionReviewUseCase {
  constructor(
    private readonly audits: AuditRepository,
    private readonly permissions: PermissionService,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    reviewId: string,
    input: Partial<{
      status: SupervisionReviewStatus;
      assignedToUserId: string;
      resolutionComment: string;
    }>
  ): Promise<SupervisionReview> {
    const review = await this.audits.findSupervisionReviewById(reviewId);
    if (!review) {
      throw new ApplicationError(
        "not_found",
        "supervision_review.not_found",
        "Supervision review not found"
      );
    }

    await this.permissions.assertPermission(actor, review.officeId, "audit.read");
    const updatedAt = this.now();
    const updated = await this.audits.updateSupervisionReview(reviewId, {
      status: input.status,
      assignedToUserId: input.assignedToUserId,
      resolutionComment: input.resolutionComment?.trim() || undefined,
      updatedAt,
      resolvedAt: input.status === "resolved" ? updatedAt : undefined
    });
    if (!updated) {
      throw new ApplicationError(
        "not_found",
        "supervision_review.not_found",
        "Supervision review not found"
      );
    }

    await this.audits.appendAuditEvent({
      id: randomUUID(),
      officeId: updated.officeId,
      actorId: actor.id,
      actorName: actor.name,
      action: "supervision.review.updated",
      resourceType: "review",
      resourceId: updated.id,
      outcome: "success",
      severity: updated.status === "resolved" ? "info" : updated.severity,
      reviewRequired: false,
      metadata: sanitizeAuditMetadata({
        auditEventId: updated.auditEventId,
        status: updated.status,
        assignedToUserId: updated.assignedToUserId,
        hasResolutionComment: Boolean(updated.resolutionComment)
      }),
      createdAt: updatedAt
    });
    this.metrics.increment("audit_events_written");
    this.metrics.increment("supervision_reviews_updated");
    return updated;
  }
}

export class RequestAuditExportUseCase {
  constructor(
    private readonly audits: AuditRepository,
    private readonly permissions: PermissionService,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    officeId: string,
    input: {
      format: AuditExportFormat;
      filters?: AuditEventFilters;
    }
  ): Promise<AuditExportJob> {
    await this.permissions.assertPermission(actor, officeId, "audit.read");
    const filters = normalizeAuditFilters(input.filters ?? {});
    const eventPage = await this.audits.listAuditEvents(officeId, {
      ...filters,
      page: 1,
      pageSize: 1
    });
    const createdAt = this.now();
    const exportJob = await this.audits.createAuditExport({
      id: randomUUID(),
      officeId,
      requestedBy: actor.id,
      format: input.format,
      filters: sanitizeAuditMetadata({ ...filters }),
      eventCount: eventPage.total,
      createdAt
    });

    await this.audits.appendAuditEvent({
      id: randomUUID(),
      officeId,
      actorId: actor.id,
      actorName: actor.name,
      action: "audit.export.requested",
      resourceType: "office",
      resourceId: officeId,
      outcome: "success",
      severity: "info",
      reviewRequired: false,
      metadata: sanitizeAuditMetadata({
        format: input.format,
        eventCount: eventPage.total
      }),
      createdAt
    });
    this.metrics.increment("audit_exports_requested");
    this.metrics.increment("audit_events_written");
    return exportJob;
  }
}

export function sanitizeAuditMetadata(input: Record<string, unknown>): SafeAuditMetadata {
  const sanitized: SafeAuditMetadata = {};
  const blockedPattern = /(token|secret|password|credential|accountNumber|rawCredential)/i;

  for (const [key, value] of Object.entries(input)) {
    if (blockedPattern.test(key) || value === undefined) {
      continue;
    }

    const safeValue = toSafeAuditMetadataValue(value);
    if (safeValue !== undefined) {
      sanitized[key] = safeValue;
    }
  }

  return sanitized;
}

function toSafeAuditMetadataValue(value: unknown): SafeAuditMetadataValue | undefined {
  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return undefined;
}

function normalizeAuditFilters(filters: AuditEventFilters): AuditEventFilters {
  return {
    actorId: filters.actorId,
    action: filters.action,
    outcome: filters.outcome,
    severity: filters.severity,
    resourceType: filters.resourceType,
    resourceId: filters.resourceId,
    clientId: filters.clientId,
    portfolioId: filters.portfolioId,
    from: filters.from,
    to: filters.to,
    page: Math.max(1, filters.page ?? 1),
    pageSize: Math.min(Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  };
}
