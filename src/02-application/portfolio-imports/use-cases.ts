import { createHash, randomUUID } from "crypto";
import { Actor } from "../../01-domain/auth/actor";
import {
  PortfolioImportJob,
  PortfolioImportStatus,
  PublicPortfolioImportJob,
  toPublicPortfolioImportJob
} from "../../01-domain/portfolio-imports/portfolio-import";
import { assertCanManageAccountLedger, assertCanReadAccountLedger } from "../auth/policies";
import { PermissionService } from "../auth/permission-service";
import { ApplicationError } from "../errors/application-error";
import { AccountRepository } from "../ports/repositories";
import {
  PortfolioImportQueue,
  PortfolioImportRepository,
  PortfolioImportStorage,
  PortfolioImportWorkbookService
} from "./ports";

const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export interface UploadedPortfolioWorkbook {
  originalFileName: string;
  mediaType: string;
  content: Buffer;
}

export class CreatePortfolioImportUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly permissions: PermissionService,
    private readonly imports: PortfolioImportRepository,
    private readonly storage: PortfolioImportStorage,
    private readonly queue: PortfolioImportQueue,
    private readonly now: () => Date = () => new Date(),
    private readonly maxBytes = DEFAULT_MAX_BYTES
  ) {}

  async execute(
    actor: Actor,
    input: {
      accountId: string;
      idempotencyKey: string;
      file: UploadedPortfolioWorkbook;
    }
  ): Promise<PublicPortfolioImportJob> {
    const account = await this.accounts.findAccountById(input.accountId);
    const membership = account
      ? await this.accounts.findMembership(input.accountId, actor.id)
      : undefined;

    try {
      assertCanManageAccountLedger(actor, account, membership);
    } catch (error) {
      if (
        !account ||
        !(error instanceof ApplicationError) ||
        error.code !== "auth.permission_denied"
      ) {
        throw error;
      }
      await this.permissions.assertPermission(actor, account.officeId, "ledger.write", {
        resourceType: "account",
        resourceId: account.id
      });
    }

    validateUpload(input.file, this.maxBytes);
    const sourceSha256 = createHash("sha256").update(input.file.content).digest("hex");
    const requestFingerprint = createHash("sha256")
      .update(`${input.accountId}:${sourceSha256}`)
      .digest("hex");
    const existing = await this.imports.findByIdempotencyKey(
      actor.id,
      input.accountId,
      input.idempotencyKey
    );

    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new ApplicationError(
          "conflict",
          "portfolio_import.idempotency_key_payload_mismatch",
          "A chave de idempotência já foi usada com outra planilha"
        );
      }
      return toPublicPortfolioImportJob(existing);
    }

    const now = this.now();
    const id = randomUUID();
    const sourceKey = `portfolio-imports/${account!.officeId}/${input.accountId}/${id}/source.xlsx`;
    await this.storage.put(sourceKey, input.file.content, XLSX_MEDIA_TYPE);

    const job: PortfolioImportJob = {
      id,
      type: "portfolio_spreadsheet_import",
      officeId: account!.officeId,
      accountId: input.accountId,
      requestedBy: actor.id,
      correlationId: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      sourceSha256,
      originalFileName: sanitizeFileName(input.file.originalFileName),
      mediaType: input.file.mediaType || XLSX_MEDIA_TYPE,
      byteSize: input.file.content.byteLength,
      sourceKey,
      status: "queued",
      phase: "upload_complete",
      attempts: 0,
      progress: emptyProgress(),
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.imports.create(job);
      await this.queue.enqueue({ jobId: job.id, accountId: job.accountId });
    } catch (error) {
      await this.storage.delete(sourceKey).catch(() => undefined);
      throw error;
    }

    return toPublicPortfolioImportJob(job);
  }
}

export class ListPortfolioImportsUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly imports: PortfolioImportRepository
  ) {}

  async execute(
    actor: Actor,
    input: { accountId: string; page: number; perPage: number; status?: PortfolioImportStatus }
  ) {
    await assertImportReadAccess(actor, input.accountId, this.accounts);
    const result = await this.imports.list(
      input.accountId,
      input.page,
      input.perPage,
      input.status
    );
    const totalPages = Math.max(1, Math.ceil(result.totalItems / input.perPage));
    return {
      jobs: result.jobs.map(toPublicPortfolioImportJob),
      pagination: {
        page: input.page,
        per_page: input.perPage,
        total_items: result.totalItems,
        total_pages: totalPages,
        has_next: input.page < totalPages,
        has_prev: input.page > 1
      }
    };
  }
}

export class GetPortfolioImportUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly imports: PortfolioImportRepository
  ) {}

  async execute(actor: Actor, importId: string): Promise<PublicPortfolioImportJob> {
    const job = await this.imports.findById(importId);
    if (!job) {
      throw new ApplicationError(
        "not_found",
        "portfolio_import.not_found",
        "Importação não encontrada"
      );
    }
    await assertImportReadAccess(actor, job.accountId, this.accounts);
    return toPublicPortfolioImportJob(job);
  }
}

export class DownloadPortfolioImportErrorReportUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly imports: PortfolioImportRepository,
    private readonly storage: PortfolioImportStorage
  ) {}

  async execute(actor: Actor, importId: string): Promise<Buffer> {
    const job = await this.imports.findById(importId);
    if (!job) {
      throw new ApplicationError(
        "not_found",
        "portfolio_import.not_found",
        "Importação não encontrada"
      );
    }
    await assertImportReadAccess(actor, job.accountId, this.accounts);
    if (!job.errorReportKey) {
      throw new ApplicationError(
        "not_found",
        "portfolio_import.error_report_not_found",
        "A planilha de erros não está disponível"
      );
    }
    return this.storage.get(job.errorReportKey);
  }
}

export class DownloadPortfolioImportTemplateUseCase {
  constructor(private readonly workbook: PortfolioImportWorkbookService) {}

  execute(): Promise<Buffer> {
    return this.workbook.createTemplate();
  }
}

async function assertImportReadAccess(
  actor: Actor,
  accountId: string,
  accounts: AccountRepository
) {
  const account = await accounts.findAccountById(accountId);
  const membership = account ? await accounts.findMembership(accountId, actor.id) : undefined;
  assertCanReadAccountLedger(actor, account, membership);
}

function validateUpload(file: UploadedPortfolioWorkbook, maxBytes: number): void {
  const name = file.originalFileName.toLowerCase();
  if (!name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    throw new ApplicationError(
      "invalid",
      "portfolio_import.unsupported_file",
      "Envie uma planilha no formato XLSX"
    );
  }
  if (file.content.byteLength === 0) {
    throw new ApplicationError("invalid", "portfolio_import.empty_file", "A planilha está vazia");
  }
  if (file.content.byteLength > maxBytes) {
    throw new ApplicationError(
      "invalid",
      "portfolio_import.file_too_large",
      "A planilha excede o limite permitido"
    );
  }
  if (file.content[0] !== 0x50 || file.content[1] !== 0x4b) {
    throw new ApplicationError(
      "invalid",
      "portfolio_import.unsupported_file",
      "O conteúdo enviado não é uma planilha XLSX válida"
    );
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "portfolio.xlsx";
}

function emptyProgress() {
  return {
    totalRows: null,
    processedRows: 0,
    succeededRows: 0,
    failedRows: 0,
    percent: 0
  };
}
