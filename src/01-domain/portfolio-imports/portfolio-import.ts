import { PortfolioTransactionType } from "../portfolios/portfolio";

export type PortfolioImportStatus = "queued" | "validating" | "committing" | "succeeded" | "failed";

export type PortfolioImportPhase =
  | "upload_complete"
  | "reading_workbook"
  | "staging_rows"
  | "validating_ledger"
  | "creating_portfolio"
  | "completed"
  | "validation_failed"
  | "technical_failed";

export interface PortfolioImportProgress {
  totalRows: number | null;
  processedRows: number;
  succeededRows: number;
  failedRows: number;
  percent: number;
}

export interface PortfolioImportRowError {
  rowNumber: number;
  externalId?: string;
  field: string;
  code: string;
  message: string;
}

export interface PortfolioImportFailure {
  code: string;
  message: string;
  errorCount: number;
  errors: PortfolioImportRowError[];
}

export interface PortfolioImportJob {
  id: string;
  type: "portfolio_spreadsheet_import";
  officeId: string;
  accountId: string;
  requestedBy: string;
  correlationId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  sourceSha256: string;
  originalFileName: string;
  mediaType: string;
  byteSize: number;
  sourceKey: string;
  templateVersion?: number;
  status: PortfolioImportStatus;
  phase: PortfolioImportPhase;
  attempts: number;
  progress: PortfolioImportProgress;
  failure?: PortfolioImportFailure;
  errorReportKey?: string;
  portfolioId?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface NormalizedPortfolioImportTransaction {
  rowNumber: number;
  externalId?: string;
  assetSymbol: string;
  assetName: string;
  tradeDate: string;
  type: PortfolioTransactionType;
  quantity: number;
  unitPrice: number;
  currency: string;
  notes?: string;
}

export interface ParsedPortfolioImportWorkbook {
  templateVersion: number;
  portfolio: {
    name: string;
    description?: string;
    baseCurrency: string;
  };
  transactions: NormalizedPortfolioImportTransaction[];
  errors: PortfolioImportRowError[];
}

export interface PublicPortfolioImportJob {
  id: string;
  type: PortfolioImportJob["type"];
  accountId: string;
  status: PortfolioImportStatus;
  phase: PortfolioImportPhase;
  originalFileName: string;
  portfolioId: string | null;
  progress: PortfolioImportProgress;
  failure: PortfolioImportFailure | null;
  errorReportAvailable: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export function toPublicPortfolioImportJob(job: PortfolioImportJob): PublicPortfolioImportJob {
  return {
    id: job.id,
    type: job.type,
    accountId: job.accountId,
    status: job.status,
    phase: job.phase,
    originalFileName: job.originalFileName,
    portfolioId: job.portfolioId ?? null,
    progress: { ...job.progress },
    failure: job.failure
      ? {
          ...job.failure,
          errors: job.failure.errors.slice(0, 20).map((error) => ({ ...error }))
        }
      : null,
    errorReportAvailable: Boolean(job.errorReportKey),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null
  };
}
