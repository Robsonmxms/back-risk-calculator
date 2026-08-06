import { randomUUID } from "crypto";
import { Actor } from "../../../01-domain/auth/actor";
import { ClientDetail } from "../../../01-domain/clients/client";
import {
  ClientPortalReadModel,
  ReportPackage,
  ReportPackageItem,
  ReportPackageStatus
} from "../../../01-domain/delivery/report-package";
import { PermissionService } from "../../auth/permission-service";
import { ApplicationError } from "../../errors/application-error";
import {
  AuditRepository,
  ClientRepository,
  ReportPackageFilters,
  ReportPackageRepository
} from "../../ports/repositories";
import { ReportRepository } from "../../../modules/reports-alerts/ports";
import { sanitizeAuditMetadata } from "../../compliance/use-cases/compliance-use-cases";

export interface ReportPackageView {
  reportPackage: ReportPackage;
  clientFacing: boolean;
}

export class ListClientReportPackagesUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly packages: ReportPackageRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(
    actor: Actor,
    clientId: string,
    filters: ReportPackageFilters
  ): Promise<ReportPackage[]> {
    const client = await requireClient(this.clients, clientId);
    await assertStaffClientPermission(actor, client, "reports.request", this.permissions);
    return this.packages.listReportPackagesByClient(clientId, filters);
  }
}

export class CreateReportPackageUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly packages: ReportPackageRepository,
    private readonly reports: ReportRepository,
    private readonly permissions: PermissionService,
    private readonly audits: AuditRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    clientId: string,
    input: {
      title: string;
      summaryNotes: string;
      internalNotes?: string;
      items: ReportPackageItem[];
      submitForApproval?: boolean;
    }
  ): Promise<ReportPackage> {
    const client = await requireClient(this.clients, clientId);
    await assertStaffClientPermission(actor, client, "reports.request", this.permissions);
    const createdAt = this.now();
    const reportPackage = await this.packages.createReportPackage({
      id: randomUUID(),
      officeId: client.officeId,
      clientId: client.id,
      householdId: client.householdId,
      title: input.title.trim(),
      summaryNotes: input.summaryNotes.trim(),
      internalNotes: input.internalNotes?.trim() || undefined,
      status: input.submitForApproval ? "pending_approval" : "draft",
      items: await this.normalizeItems(input.items),
      createdBy: actor.id,
      createdAt,
      updatedAt: createdAt
    });
    await this.audit(actor, reportPackage, "report_package.created", "info", {
      status: reportPackage.status,
      itemCount: reportPackage.items.length
    });
    return reportPackage;
  }

  private async normalizeItems(items: ReportPackageItem[]): Promise<ReportPackageItem[]> {
    if (items.length === 0) {
      throw new ApplicationError(
        "invalid",
        "report_package.items_required",
        "Report package requires at least one item"
      );
    }

    return Promise.all(
      items.map(async (item) => {
        const normalized: ReportPackageItem = {
          id: item.id || randomUUID(),
          type: item.type,
          title: item.title.trim(),
          portfolioId: item.portfolioId,
          reportId: item.reportId,
          analyticsSnapshotId: item.analyticsSnapshotId,
          format: item.format,
          status: item.status ?? "ready"
        };

        if (normalized.type === "report" && normalized.reportId) {
          const report = await this.reports.findReportById(normalized.reportId);
          if (!report) {
            return { ...normalized, status: "unavailable" as const };
          }
          return {
            ...normalized,
            portfolioId: normalized.portfolioId ?? report.portfolioId,
            format: normalized.format ?? report.format,
            status:
              report.status === "ready"
                ? "ready"
                : report.status === "failed"
                  ? "unavailable"
                  : "pending"
          };
        }

        return normalized;
      })
    );
  }

  private async audit(
    actor: Actor,
    reportPackage: ReportPackage,
    action: string,
    severity: "info" | "warning" | "critical",
    metadata: Record<string, unknown>
  ) {
    await appendPackageAudit(this.audits, actor, reportPackage, action, severity, metadata);
  }
}

export class GetReportPackageUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly packages: ReportPackageRepository,
    private readonly permissions: PermissionService
  ) {}

  async execute(actor: Actor, packageId: string): Promise<ReportPackageView> {
    const reportPackage = await requirePackage(this.packages, packageId);
    const client = await requireClient(this.clients, reportPackage.clientId);

    if (await canReadStaffPackage(actor, client, this.permissions)) {
      return { reportPackage, clientFacing: false };
    }

    const clientIds = await clientPortalClientIds(actor, this.permissions);
    if (
      clientIds.has(reportPackage.clientId) &&
      ["delivered", "viewed"].includes(reportPackage.status)
    ) {
      return { reportPackage: stripInternalPackage(reportPackage), clientFacing: true };
    }

    throw new ApplicationError("forbidden", "auth.permission_denied", "Permission denied");
  }
}

export class UpdateReportPackageUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly packages: ReportPackageRepository,
    private readonly permissions: PermissionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(
    actor: Actor,
    packageId: string,
    input: Partial<{
      title: string;
      summaryNotes: string;
      internalNotes: string;
      status: Extract<ReportPackageStatus, "draft" | "pending_approval">;
      items: ReportPackageItem[];
    }>
  ): Promise<ReportPackage> {
    const current = await requirePackage(this.packages, packageId);
    const client = await requireClient(this.clients, current.clientId);
    await assertStaffClientPermission(actor, client, "reports.request", this.permissions);
    if (["delivered", "viewed", "revoked"].includes(current.status)) {
      throw new ApplicationError(
        "conflict",
        "report_package.locked",
        "Delivered or revoked packages cannot be edited"
      );
    }

    const updated = await this.packages.updateReportPackage(packageId, {
      title: input.title?.trim(),
      summaryNotes: input.summaryNotes?.trim(),
      internalNotes: input.internalNotes?.trim() || undefined,
      status: input.status,
      items: input.items,
      updatedAt: this.now()
    });
    if (!updated) {
      throw new ApplicationError(
        "not_found",
        "report_package.not_found",
        "Report package not found"
      );
    }
    return updated;
  }
}

export class ApproveReportPackageUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly packages: ReportPackageRepository,
    private readonly permissions: PermissionService,
    private readonly audits: AuditRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor, packageId: string): Promise<ReportPackage> {
    const reportPackage = await requirePackage(this.packages, packageId);
    const client = await requireClient(this.clients, reportPackage.clientId);
    await assertStaffClientPermission(actor, client, "reports.approve", this.permissions);
    if (!["draft", "pending_approval"].includes(reportPackage.status)) {
      throw new ApplicationError(
        "conflict",
        "report_package.not_approvable",
        "Only draft or pending packages can be approved"
      );
    }

    const approvedAt = this.now();
    const approved = await this.packages.updateReportPackage(packageId, {
      status: "approved",
      approvedBy: actor.id,
      approvedAt,
      updatedAt: approvedAt
    });
    if (!approved) {
      throw new ApplicationError(
        "not_found",
        "report_package.not_found",
        "Report package not found"
      );
    }
    await appendPackageAudit(this.audits, actor, approved, "report_package.approved", "info", {
      status: approved.status
    });
    return approved;
  }
}

export class DeliverReportPackageUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly packages: ReportPackageRepository,
    private readonly permissions: PermissionService,
    private readonly audits: AuditRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor, packageId: string): Promise<ReportPackage> {
    const reportPackage = await requirePackage(this.packages, packageId);
    const client = await requireClient(this.clients, reportPackage.clientId);
    await assertStaffClientPermission(actor, client, "reports.approve", this.permissions);
    if (reportPackage.status !== "approved") {
      throw new ApplicationError(
        "conflict",
        "report_package.not_approved",
        "Report package must be approved before delivery"
      );
    }
    assertItemsReady(reportPackage.items);

    const deliveredAt = this.now();
    const delivered = await this.packages.updateReportPackage(packageId, {
      status: "delivered",
      deliveredBy: actor.id,
      deliveredAt,
      updatedAt: deliveredAt
    });
    if (!delivered) {
      throw new ApplicationError(
        "not_found",
        "report_package.not_found",
        "Report package not found"
      );
    }
    await appendPackageAudit(this.audits, actor, delivered, "report_package.delivered", "info", {
      status: delivered.status,
      itemCount: delivered.items.length
    });
    return delivered;
  }
}

export class RevokeReportPackageUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly packages: ReportPackageRepository,
    private readonly permissions: PermissionService,
    private readonly audits: AuditRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor, packageId: string): Promise<ReportPackage> {
    const reportPackage = await requirePackage(this.packages, packageId);
    const client = await requireClient(this.clients, reportPackage.clientId);
    await assertStaffClientPermission(actor, client, "reports.approve", this.permissions);

    const revokedAt = this.now();
    const revoked = await this.packages.updateReportPackage(packageId, {
      status: "revoked",
      revokedBy: actor.id,
      revokedAt,
      updatedAt: revokedAt
    });
    if (!revoked) {
      throw new ApplicationError(
        "not_found",
        "report_package.not_found",
        "Report package not found"
      );
    }
    await appendPackageAudit(this.audits, actor, revoked, "report_package.revoked", "warning", {
      previousStatus: reportPackage.status
    });
    return revoked;
  }
}

export class GetClientPortalUseCase {
  constructor(
    private readonly clients: ClientRepository,
    private readonly packages: ReportPackageRepository,
    private readonly permissions: PermissionService,
    private readonly audits: AuditRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(actor: Actor): Promise<ClientPortalReadModel> {
    const visibleClientIds = await clientPortalClientIds(actor, this.permissions);
    if (visibleClientIds.size === 0) {
      return { actorId: actor.id, generatedAt: this.now(), clients: [], packages: [] };
    }

    const clientDetails = (
      await Promise.all(
        Array.from(visibleClientIds).map((clientId) => this.clients.findClientById(clientId))
      )
    ).filter((client): client is ClientDetail => Boolean(client));
    const packages = (
      await Promise.all(
        clientDetails.map(async (client) => {
          const visiblePackages = await this.packages.listReportPackagesByClient(client.id);
          return visiblePackages
            .filter((reportPackage) => ["delivered", "viewed"].includes(reportPackage.status))
            .map((reportPackage) => ({ client, reportPackage }));
        })
      )
    ).flat();

    const viewedPackages = await Promise.all(
      packages.map(async ({ client, reportPackage }) => {
        const viewed = await this.markViewed(actor, reportPackage);
        const itemPortfolioIds = new Set(
          viewed.items.map((item) => item.portfolioId).filter((id): id is string => Boolean(id))
        );
        return {
          ...stripInternalPackage(viewed),
          status: viewed.status === "delivered" ? ("viewed" as const) : ("viewed" as const),
          portfolios: client.portfolios.filter(
            (portfolio) => itemPortfolioIds.size === 0 || itemPortfolioIds.has(portfolio.id)
          )
        };
      })
    );

    return {
      actorId: actor.id,
      generatedAt: this.now(),
      clients: clientDetails.map((client) => ({
        id: client.id,
        officeId: client.officeId,
        name: client.name,
        householdName: client.householdName
      })),
      packages: viewedPackages
    };
  }

  private async markViewed(actor: Actor, reportPackage: ReportPackage): Promise<ReportPackage> {
    if (reportPackage.status === "viewed") {
      return reportPackage;
    }

    const viewedAt = this.now();
    const viewed = await this.packages.updateReportPackage(reportPackage.id, {
      status: "viewed",
      viewedBy: actor.id,
      viewedAt,
      updatedAt: viewedAt
    });
    const updated = viewed ?? reportPackage;
    await appendPackageAudit(this.audits, actor, updated, "report_package.viewed", "info", {
      status: "viewed"
    });
    return updated;
  }
}

async function requireClient(clients: ClientRepository, clientId: string): Promise<ClientDetail> {
  const client = await clients.findClientById(clientId);
  if (!client) {
    throw new ApplicationError("not_found", "client.not_found", "Client not found");
  }
  return client;
}

async function requirePackage(
  packages: ReportPackageRepository,
  packageId: string
): Promise<ReportPackage> {
  const reportPackage = await packages.findReportPackageById(packageId);
  if (!reportPackage) {
    throw new ApplicationError("not_found", "report_package.not_found", "Report package not found");
  }
  return reportPackage;
}

async function assertStaffClientPermission(
  actor: Actor,
  client: ClientDetail,
  permission: "reports.request" | "reports.approve",
  permissions: PermissionService
) {
  const evaluation = await permissions.assertPermission(actor, client.officeId, permission, {
    resourceType: "client",
    resourceId: client.id
  });
  if (evaluation.role === "client") {
    throw new ApplicationError("forbidden", "auth.permission_denied", "Permission denied");
  }
}

async function canReadStaffPackage(
  actor: Actor,
  client: ClientDetail,
  permissions: PermissionService
): Promise<boolean> {
  try {
    const evaluation = await permissions.assertPermission(actor, client.officeId, "client.read", {
      resourceType: "client",
      resourceId: client.id
    });
    return evaluation.role !== "client";
  } catch {
    return false;
  }
}

async function clientPortalClientIds(
  actor: Actor,
  permissions: PermissionService
): Promise<Set<string>> {
  const clientIds = new Set<string>();
  for (const office of actor.officeMemberships) {
    const evaluation = await permissions.evaluate(actor, office.officeId);
    for (const assignment of evaluation.assignments) {
      if (
        !assignment.revokedAt &&
        assignment.resourceType === "client" &&
        assignment.permissions.includes("client.read")
      ) {
        clientIds.add(assignment.resourceId);
      }
    }
  }
  return clientIds;
}

function assertItemsReady(items: ReportPackageItem[]) {
  const blockingItem = items.find((item) => item.status !== "ready");
  if (blockingItem) {
    throw new ApplicationError(
      "invalid",
      "report_package.items_not_ready",
      `Package item ${blockingItem.title} is not ready`
    );
  }
}

function stripInternalPackage(reportPackage: ReportPackage): ReportPackage {
  return {
    ...reportPackage,
    internalNotes: undefined,
    items: reportPackage.items.map((item) => ({ ...item }))
  };
}

async function appendPackageAudit(
  audits: AuditRepository,
  actor: Actor,
  reportPackage: ReportPackage,
  action: string,
  severity: "info" | "warning" | "critical",
  metadata: Record<string, unknown>
) {
  await audits.appendAuditEvent({
    id: randomUUID(),
    officeId: reportPackage.officeId,
    actorId: actor.id,
    actorName: actor.name,
    action,
    resourceType: "delivery",
    resourceId: reportPackage.id,
    clientId: reportPackage.clientId,
    portfolioId: reportPackage.items[0]?.portfolioId,
    outcome: "success",
    severity,
    reviewRequired: false,
    metadata: sanitizeAuditMetadata(metadata),
    createdAt: new Date()
  });
}
