import { Request, Response } from "express";
import {
  GetOfficeAdminChartsUseCase,
  GetPlatformAdminChartsUseCase
} from "../../02-application/offices/use-cases/operational-chart-use-cases";
import { OfficeAdminChartsQuery } from "../../02-application/offices/use-cases/operational-chart-types";
import { ApiError, ok } from "../http";
import { AuthenticatedRequest } from "../request";

export class OperationalChartsController {
  constructor(
    private readonly getOfficeAdminChartsUseCase: GetOfficeAdminChartsUseCase,
    private readonly getPlatformAdminChartsUseCase: GetPlatformAdminChartsUseCase
  ) {}

  getOfficeAdminCharts = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const result = await this.getOfficeAdminChartsUseCase.execute(
      actor,
      requireOfficeId(request),
      validatedQuery(request)
    );
    return ok(response, result.data, result.meta);
  };

  getPlatformAdminCharts = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const result = await this.getPlatformAdminChartsUseCase.execute(
      actor,
      validatedQuery(request)
    );
    return ok(response, result.data, result.meta);
  };
}

function requireOfficeId(request: Request): string {
  const { officeId } = request.params;
  if (typeof officeId !== "string") {
    throw new ApiError(400, "request.invalid_office_id", "Invalid office id");
  }
  return officeId;
}

function validatedQuery(request: Request): OfficeAdminChartsQuery {
  return ((request as Request & { validatedQuery?: OfficeAdminChartsQuery }).validatedQuery ?? {
    range: "30d"
  }) as OfficeAdminChartsQuery;
}
