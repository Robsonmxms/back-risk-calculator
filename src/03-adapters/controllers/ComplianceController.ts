import { Request, Response } from "express";
import {
  AuditEvent,
  AuditExportJob,
  SupervisionReview
} from "../../01-domain/compliance/audit";
import {
  GetAuditEventUseCase,
  ListAuditEventsUseCase,
  ListSupervisionReviewsUseCase,
  RequestAuditExportUseCase,
  UpdateSupervisionReviewUseCase
} from "../../02-application/compliance/use-cases/compliance-use-cases";
import {
  AuditEventFilters,
  SupervisionReviewFilters
} from "../../02-application/ports/repositories";
import { ApiError, ok } from "../http";
import { AuthenticatedRequest } from "../request";

export class ComplianceController {
  constructor(
    private readonly listAuditEventsUseCase: ListAuditEventsUseCase,
    private readonly getAuditEventUseCase: GetAuditEventUseCase,
    private readonly listSupervisionReviewsUseCase: ListSupervisionReviewsUseCase,
    private readonly updateSupervisionReviewUseCase: UpdateSupervisionReviewUseCase,
    private readonly requestAuditExportUseCase: RequestAuditExportUseCase
  ) {}

  listAuditEvents = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const page = await this.listAuditEventsUseCase.execute(
      actor,
      requireOfficeId(request),
      ((request as Request & { validatedQuery?: AuditEventFilters }).validatedQuery ?? {})
    );

    return ok(
      response,
      { auditEvents: page.events.map(serializeAuditEvent) },
      { total: page.total, page: page.page, pageSize: page.pageSize }
    );
  };

  getAuditEvent = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const event = await this.getAuditEventUseCase.execute(actor, requireAuditEventId(request));
    return ok(response, serializeAuditEvent(event));
  };

  listSupervisionReviews = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const reviews = await this.listSupervisionReviewsUseCase.execute(
      actor,
      requireOfficeId(request),
      ((request as Request & { validatedQuery?: SupervisionReviewFilters }).validatedQuery ?? {})
    );
    return ok(
      response,
      { supervisionReviews: reviews.map(serializeSupervisionReview) },
      { count: reviews.length }
    );
  };

  updateSupervisionReview = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const review = await this.updateSupervisionReviewUseCase.execute(
      actor,
      requireReviewId(request),
      request.body
    );
    return ok(response, serializeSupervisionReview(review));
  };

  requestAuditExport = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const exportJob = await this.requestAuditExportUseCase.execute(
      actor,
      requireOfficeId(request),
      request.body
    );
    return ok(response.status(202), serializeAuditExport(exportJob));
  };
}

function requireOfficeId(request: Request): string {
  const { officeId } = request.params;
  if (typeof officeId !== "string") {
    throw new ApiError(400, "request.invalid_office_id", "Invalid office id");
  }
  return officeId;
}

function requireAuditEventId(request: Request): string {
  const { auditEventId } = request.params;
  if (typeof auditEventId !== "string") {
    throw new ApiError(400, "request.invalid_audit_event_id", "Invalid audit event id");
  }
  return auditEventId;
}

function requireReviewId(request: Request): string {
  const { reviewId } = request.params;
  if (typeof reviewId !== "string") {
    throw new ApiError(400, "request.invalid_review_id", "Invalid review id");
  }
  return reviewId;
}

function serializeAuditEvent(event: AuditEvent) {
  return {
    ...event,
    createdAt: event.createdAt.toISOString()
  };
}

function serializeSupervisionReview(review: SupervisionReview) {
  return {
    ...review,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
    resolvedAt: review.resolvedAt?.toISOString()
  };
}

function serializeAuditExport(exportJob: AuditExportJob) {
  return {
    ...exportJob,
    createdAt: exportJob.createdAt.toISOString(),
    completedAt: exportJob.completedAt.toISOString()
  };
}
