import { randomUUID } from "crypto";
import { PortfolioImportRowError } from "../../01-domain/portfolio-imports/portfolio-import";
import { LoggerPort, MetricsPort } from "../ports/observability";
import { AccountRepository, PortfolioRepository } from "../ports/repositories";
import {
  PortfolioImportQueue,
  PortfolioImportRepository,
  PortfolioImportStorage,
  PortfolioImportWorkbookService
} from "./ports";

export class PortfolioImportWorker {
  private draining = false;

  constructor(
    private readonly accounts: AccountRepository,
    private readonly portfolios: PortfolioRepository,
    private readonly imports: PortfolioImportRepository,
    private readonly storage: PortfolioImportStorage,
    private readonly queue: PortfolioImportQueue,
    private readonly workbook: PortfolioImportWorkbookService,
    private readonly logger: LoggerPort,
    private readonly metrics: MetricsPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      let message = await this.queue.dequeue();
      while (message) {
        await this.process(message.jobId, message);
        await this.queue.acknowledge(message);
        message = await this.queue.dequeue();
      }
    } finally {
      this.draining = false;
    }
  }

  async process(
    jobId: string,
    queueMessage?: import("./ports").PortfolioImportQueueMessage
  ): Promise<void> {
    const job = await this.imports.findById(jobId);
    if (!job || job.status === "succeeded" || job.status === "failed") {
      return;
    }

    const startedAt = this.now();
    const attempts = job.attempts + 1;
    await this.imports.update(job.id, {
      status: "validating",
      phase: "reading_workbook",
      attempts,
      startedAt: job.startedAt ?? startedAt,
      updatedAt: startedAt
    });
    this.metrics.increment("portfolio_import.started");

    try {
      const source = await this.storage.get(job.sourceKey);
      const parsed = await this.workbook.parse(source);
      const totalRows = parsed.transactions.length + parsed.errors.length;

      await this.imports.update(job.id, {
        templateVersion: parsed.templateVersion,
        phase: "validating_ledger",
        progress: {
          totalRows,
          processedRows: totalRows,
          succeededRows: parsed.transactions.length,
          failedRows: parsed.errors.length,
          percent: 100
        },
        updatedAt: this.now()
      });

      if (parsed.errors.length > 0) {
        await this.failValidation(job.id, job.sourceKey, parsed.errors, source);
        return;
      }

      const account = await this.accounts.findAccountById(job.accountId);
      if (!account) {
        await this.failValidation(
          job.id,
          job.sourceKey,
          [rowError(0, "accountId", "account.not_found", "A conta selecionada não existe mais")],
          source
        );
        return;
      }

      await this.imports.update(job.id, {
        status: "committing",
        phase: "creating_portfolio",
        updatedAt: this.now()
      });

      // Reuse the import identifier so a retry after the atomic ledger commit cannot
      // create a second portfolio if the job status update was interrupted.
      const portfolioId = job.id;
      const createdAt = this.now();
      await this.portfolios.createImportedPortfolio({
        importId: job.id,
        portfolio: {
          id: portfolioId,
          officeId: account.officeId,
          accountId: account.id,
          clientId: account.clientId,
          householdId: account.householdId,
          name: parsed.portfolio.name,
          description: parsed.portfolio.description,
          baseCurrency: parsed.portfolio.baseCurrency,
          createdAt,
          updatedAt: createdAt
        },
        transactions: parsed.transactions.map((transaction) => ({
          id: randomUUID(),
          portfolioId,
          assetSymbol: transaction.assetSymbol,
          assetName: transaction.assetName,
          tradeDate: transaction.tradeDate,
          type: transaction.type,
          quantity: transaction.quantity,
          unitPrice: transaction.unitPrice,
          totalAmount: Number((transaction.quantity * transaction.unitPrice).toFixed(2)),
          currency: transaction.currency,
          notes: transaction.notes,
          idempotencyKey: `${job.id}:${transaction.rowNumber}`,
          idempotencyFingerprint: job.requestFingerprint,
          source: "spreadsheet_import",
          importId: job.id,
          sourceRowNumber: transaction.rowNumber,
          createdAt
        }))
      });

      const completedAt = this.now();
      await this.imports.update(job.id, {
        status: "succeeded",
        phase: "completed",
        portfolioId,
        completedAt,
        updatedAt: completedAt
      });
      this.metrics.increment("portfolio_import.succeeded");
      this.metrics.increment("portfolio_import.rows_succeeded", parsed.transactions.length);
      this.logger.info("portfolio_import.succeeded", {
        importId: job.id,
        officeId: job.officeId,
        accountId: job.accountId,
        requestedBy: job.requestedBy,
        correlationId: job.correlationId,
        rowCount: parsed.transactions.length,
        durationMs: completedAt.getTime() - startedAt.getTime()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "portfolio_import.unexpected_error";
      if (attempts < 3) {
        await this.imports.update(job.id, {
          status: "queued",
          phase: "upload_complete",
          updatedAt: this.now()
        });
        await this.queue.enqueue({ jobId: job.id, accountId: job.accountId });
        this.metrics.increment("portfolio_import.retry");
        this.logger.warn("portfolio_import.retrying", {
          importId: job.id,
          correlationId: job.correlationId,
          attempts,
          errorCode: message
        });
        return;
      }

      const completedAt = this.now();
      await this.imports.update(job.id, {
        status: "failed",
        phase: "technical_failed",
        failure: {
          code: "portfolio_import.processing_failed",
          message: "Não foi possível processar a planilha após novas tentativas.",
          errorCount: 0,
          errors: []
        },
        completedAt,
        updatedAt: completedAt
      });
      if (queueMessage) {
        await this.queue.deadLetter(queueMessage, {
          accountId: job.accountId,
          reason: "portfolio_import.processing_failed"
        });
      }
      this.metrics.increment("portfolio_import.failed");
      this.logger.warn("portfolio_import.failed", {
        importId: job.id,
        correlationId: job.correlationId,
        attempts,
        errorCode: message
      });
    }
  }

  private async failValidation(
    jobId: string,
    sourceKey: string,
    errors: PortfolioImportRowError[],
    source: Buffer
  ): Promise<void> {
    const report = await this.workbook.createErrorReport(errors, source);
    const errorReportKey = sourceKey.replace(/source\.xlsx$/, "errors.xlsx");
    await this.storage.put(
      errorReportKey,
      report,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const completedAt = this.now();
    await this.imports.update(jobId, {
      status: "failed",
      phase: "validation_failed",
      errorReportKey,
      failure: {
        code: "portfolio_import.validation_failed",
        message: "A planilha possui erros. Nenhum portfólio foi criado.",
        errorCount: errors.length,
        errors
      },
      completedAt,
      updatedAt: completedAt
    });
    this.metrics.increment("portfolio_import.failed");
    this.metrics.increment("portfolio_import.validation_errors", errors.length);
  }
}

function rowError(
  rowNumber: number,
  field: string,
  code: string,
  message: string
): PortfolioImportRowError {
  return { rowNumber, field, code, message };
}
