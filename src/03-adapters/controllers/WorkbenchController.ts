import { Request, Response } from "express";
import { ReviewItem, StaffWorkbench } from "../../01-domain/workbench/workbench";
import { ReviewItemFilters } from "../../02-application/ports/repositories";
import {
  CreateReviewItemUseCase,
  GetWorkbenchUseCase,
  ListReviewItemsUseCase,
  UpdateReviewItemUseCase
} from "../../02-application/workbench/use-cases/workbench-use-cases";
import { ApiError, ok } from "../http";
import { AuthenticatedRequest } from "../request";

export class WorkbenchController {
  constructor(
    private readonly getWorkbenchUseCase: GetWorkbenchUseCase,
    private readonly listReviewItemsUseCase: ListReviewItemsUseCase,
    private readonly createReviewItemUseCase: CreateReviewItemUseCase,
    private readonly updateReviewItemUseCase: UpdateReviewItemUseCase
  ) {}

  getWorkbench = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const workbench = await this.getWorkbenchUseCase.execute(actor, requireOfficeId(request));
    return ok(response, serializeWorkbench(workbench));
  };

  listReviewItems = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const items = await this.listReviewItemsUseCase.execute(
      actor,
      requireOfficeId(request),
      ((request as Request & { validatedQuery?: ReviewItemFilters }).validatedQuery ?? {})
    );
    return ok(response, { reviewItems: items.map(serializeReviewItem) }, { count: items.length });
  };

  createReviewItem = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const item = await this.createReviewItemUseCase.execute(
      actor,
      requireOfficeId(request),
      request.body
    );
    return ok(response.status(201), serializeReviewItem(item));
  };

  updateReviewItem = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const item = await this.updateReviewItemUseCase.execute(
      actor,
      requireReviewItemId(request),
      request.body
    );
    return ok(response, serializeReviewItem(item));
  };
}

function requireOfficeId(request: Request): string {
  const { officeId } = request.params;
  if (typeof officeId !== "string") {
    throw new ApiError(400, "request.invalid_office_id", "Invalid office id");
  }
  return officeId;
}

function requireReviewItemId(request: Request): string {
  const { reviewItemId } = request.params;
  if (typeof reviewItemId !== "string") {
    throw new ApiError(400, "request.invalid_review_item_id", "Invalid review item id");
  }
  return reviewItemId;
}

function serializeWorkbench(workbench: StaffWorkbench) {
  return {
    ...workbench,
    generatedAt: workbench.generatedAt.toISOString(),
    reviewItems: workbench.reviewItems.map(serializeReviewItem)
  };
}

function serializeReviewItem(item: ReviewItem) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    closedAt: item.closedAt?.toISOString()
  };
}
