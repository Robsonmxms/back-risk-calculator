import { Request, Response } from "express";
import {
  CreatePortfolioImportUseCase,
  DownloadPortfolioImportErrorReportUseCase,
  DownloadPortfolioImportTemplateUseCase,
  GetPortfolioImportUseCase,
  ListPortfolioImportsUseCase
} from "../../02-application/portfolio-imports/use-cases";
import { PortfolioImportStatus } from "../../01-domain/portfolio-imports/portfolio-import";
import { ApiError, ok } from "../http";
import { PortfolioImportMultipartRequest } from "../middlewares/PortfolioImportMultipartMiddleware";
import { AuthenticatedRequest } from "../request";

interface ValidatedListQueryRequest extends AuthenticatedRequest {
  validatedQuery?: {
    accountId: string;
    status?: PortfolioImportStatus;
    page: number;
    per_page: number;
  };
}

export class PortfolioImportController {
  constructor(
    private readonly downloadTemplateUseCase: DownloadPortfolioImportTemplateUseCase,
    private readonly createImportUseCase: CreatePortfolioImportUseCase,
    private readonly listImportsUseCase: ListPortfolioImportsUseCase,
    private readonly getImportUseCase: GetPortfolioImportUseCase,
    private readonly downloadErrorReportUseCase: DownloadPortfolioImportErrorReportUseCase,
    private readonly scheduleWorker: () => void
  ) {}

  downloadTemplate = async (_request: Request, response: Response) => {
    const content = await this.downloadTemplateUseCase.execute();
    response.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    response.header(
      "Content-Disposition",
      'attachment; filename="modelo-importacao-portfolio-v1.xlsx"'
    );
    response.header("X-Template-Version", "1");
    response.header("X-Max-Upload-Bytes", String(10 * 1024 * 1024));
    response.header("X-Max-Rows", "10000");
    return response.send(content);
  };

  createImport = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const file = (request as PortfolioImportMultipartRequest).portfolioImportFile;
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey) {
      throw new ApiError(
        400,
        "portfolio_import.idempotency_key_required",
        "O cabeçalho Idempotency-Key é obrigatório"
      );
    }
    if (!file) {
      throw new ApiError(400, "request.validation_failed", "Selecione uma planilha");
    }
    const job = await this.createImportUseCase.execute(actor, {
      accountId: String(request.body.accountId),
      idempotencyKey,
      file
    });
    this.scheduleWorker();
    return response.status(202).json({ data: job, meta: { pollAfterMs: 1000 } });
  };

  listImports = async (request: Request, response: Response) => {
    const typedRequest = request as ValidatedListQueryRequest;
    const actor = typedRequest.actor;
    const query = typedRequest.validatedQuery;
    if (!query) {
      throw new ApiError(400, "request.validation_failed", "Consulta inválida");
    }
    const result = await this.listImportsUseCase.execute(actor, {
      accountId: query.accountId,
      status: query.status,
      page: query.page,
      perPage: query.per_page
    });
    return ok(response, { imports: result.jobs }, { pagination: result.pagination });
  };

  getImport = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const importId = requireImportId(request);
    const job = await this.getImportUseCase.execute(actor, importId);
    return ok(response, job, { pollAfterMs: isTerminal(job.status) ? null : 1000 });
  };

  downloadErrorReport = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const importId = requireImportId(request);
    const content = await this.downloadErrorReportUseCase.execute(actor, importId);
    response.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    response.header(
      "Content-Disposition",
      `attachment; filename="erros-importacao-portfolio-${importId}.xlsx"`
    );
    return response.send(content);
  };
}

function requireImportId(request: Request): string {
  const importId = request.params.importId;
  if (typeof importId !== "string" || importId.length === 0) {
    throw new ApiError(400, "request.invalid_import_id", "Identificador de importação inválido");
  }
  return importId;
}

function isTerminal(status: PortfolioImportStatus): boolean {
  return status === "succeeded" || status === "failed";
}
