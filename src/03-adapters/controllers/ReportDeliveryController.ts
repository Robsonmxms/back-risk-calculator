import { Request, Response } from "express";
import { ClientPortalReadModel, ReportPackage } from "../../01-domain/delivery/report-package";
import {
  ApproveReportPackageUseCase,
  CreateReportPackageUseCase,
  DeliverReportPackageUseCase,
  GetClientPortalUseCase,
  GetReportPackageUseCase,
  ListClientReportPackagesUseCase,
  ReportPackageView,
  RevokeReportPackageUseCase,
  UpdateReportPackageUseCase
} from "../../02-application/delivery/use-cases/report-delivery-use-cases";
import { GetDeliveryChartsUseCase } from "../../02-application/compliance/use-cases/compliance-delivery-chart-use-cases";
import { DeliveryChartsQuery } from "../../02-application/compliance/use-cases/compliance-delivery-chart-types";
import { ReportPackageFilters } from "../../02-application/ports/repositories";
import { ApiError, ok } from "../http";
import { AuthenticatedRequest } from "../request";

export class ReportDeliveryController {
  constructor(
    private readonly listClientReportPackagesUseCase: ListClientReportPackagesUseCase,
    private readonly createReportPackageUseCase: CreateReportPackageUseCase,
    private readonly getReportPackageUseCase: GetReportPackageUseCase,
    private readonly updateReportPackageUseCase: UpdateReportPackageUseCase,
    private readonly approveReportPackageUseCase: ApproveReportPackageUseCase,
    private readonly deliverReportPackageUseCase: DeliverReportPackageUseCase,
    private readonly revokeReportPackageUseCase: RevokeReportPackageUseCase,
    private readonly getClientPortalUseCase: GetClientPortalUseCase,
    private readonly getDeliveryChartsUseCase: GetDeliveryChartsUseCase
  ) {}

  listClientReportPackages = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const packages = await this.listClientReportPackagesUseCase.execute(
      actor,
      requireParam(request, "clientId"),
      (request as Request & { validatedQuery?: ReportPackageFilters }).validatedQuery ?? {}
    );
    return ok(
      response,
      { reportPackages: packages.map((reportPackage) => serializePackage(reportPackage, false)) },
      { count: packages.length }
    );
  };

  createReportPackage = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const reportPackage = await this.createReportPackageUseCase.execute(
      actor,
      requireParam(request, "clientId"),
      request.body
    );
    return ok(response.status(201), serializePackage(reportPackage, false));
  };

  getReportPackage = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const view = await this.getReportPackageUseCase.execute(
      actor,
      requireParam(request, "packageId")
    );
    return ok(response, serializePackageView(view));
  };

  updateReportPackage = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const reportPackage = await this.updateReportPackageUseCase.execute(
      actor,
      requireParam(request, "packageId"),
      request.body
    );
    return ok(response, serializePackage(reportPackage, false));
  };

  approveReportPackage = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const reportPackage = await this.approveReportPackageUseCase.execute(
      actor,
      requireParam(request, "packageId")
    );
    return ok(response, serializePackage(reportPackage, false));
  };

  deliverReportPackage = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const reportPackage = await this.deliverReportPackageUseCase.execute(
      actor,
      requireParam(request, "packageId")
    );
    return ok(response, serializePackage(reportPackage, false));
  };

  revokeReportPackage = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const reportPackage = await this.revokeReportPackageUseCase.execute(
      actor,
      requireParam(request, "packageId")
    );
    return ok(response, serializePackage(reportPackage, false));
  };

  getClientPortal = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portal = await this.getClientPortalUseCase.execute(actor);
    return ok(response, serializeClientPortal(portal));
  };

  getDeliveryCharts = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const result = await this.getDeliveryChartsUseCase.execute(
      actor,
      requireParam(request, "officeId"),
      (request as Request & { validatedQuery?: DeliveryChartsQuery }).validatedQuery ?? {
        range: "30d"
      }
    );
    return ok(response, result.data, result.meta);
  };
}

function requireParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") {
    throw new ApiError(400, "request.invalid_param", `Invalid ${name}`);
  }
  return value;
}

function serializePackageView(view: ReportPackageView) {
  return serializePackage(view.reportPackage, view.clientFacing);
}

function serializePackage(reportPackage: ReportPackage, clientFacing: boolean) {
  return {
    ...reportPackage,
    internalNotes: clientFacing ? undefined : reportPackage.internalNotes,
    items: reportPackage.items,
    createdAt: reportPackage.createdAt.toISOString(),
    updatedAt: reportPackage.updatedAt.toISOString(),
    approvedAt: reportPackage.approvedAt?.toISOString(),
    deliveredAt: reportPackage.deliveredAt?.toISOString(),
    viewedAt: reportPackage.viewedAt?.toISOString(),
    revokedAt: reportPackage.revokedAt?.toISOString()
  };
}

function serializeClientPortal(portal: ClientPortalReadModel) {
  return {
    ...portal,
    generatedAt: portal.generatedAt.toISOString(),
    packages: portal.packages.map((reportPackage) => ({
      ...reportPackage,
      items: reportPackage.items,
      deliveredAt: reportPackage.deliveredAt?.toISOString(),
      viewedAt: reportPackage.viewedAt?.toISOString()
    }))
  };
}
