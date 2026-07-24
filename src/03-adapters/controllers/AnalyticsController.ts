import { Request, Response } from "express";
import {
  CreateAnalystChartJobUseCase,
  GetAnalystChartJobUseCase,
  GetAnalystChartsUseCase
} from "../../modules/analytics/analyst-chart-use-cases";
import {
  GetPortfolioAnalyticsUseCase,
  ListPortfolioAnalyticsHistoryUseCase,
  RequestPortfolioAnalyticsRecomputeUseCase
} from "../../modules/analytics/use-cases";
import { GetPortfolioChartsUseCase } from "../../modules/analytics/chart-use-cases";
import { PortfolioChartsQuery } from "../../modules/analytics/chart-types";
import { AnalystChartJob, AnalystChartsQuery } from "../../modules/analytics/analyst-chart-types";
import { AuthenticatedRequest } from "../request";
import { ApiError, ok } from "../http";

export class AnalyticsController {
  constructor(
    private readonly getPortfolioAnalyticsUseCase: GetPortfolioAnalyticsUseCase,
    private readonly requestPortfolioAnalyticsRecomputeUseCase: RequestPortfolioAnalyticsRecomputeUseCase,
    private readonly listPortfolioAnalyticsHistoryUseCase: ListPortfolioAnalyticsHistoryUseCase,
    private readonly getPortfolioChartsUseCase: GetPortfolioChartsUseCase,
    private readonly getAnalystChartsUseCase: GetAnalystChartsUseCase,
    private readonly createAnalystChartJobUseCase: CreateAnalystChartJobUseCase,
    private readonly getAnalystChartJobUseCase: GetAnalystChartJobUseCase
  ) {}

  getPortfolioAnalytics = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requirePortfolioId(request);
    const analytics = await this.getPortfolioAnalyticsUseCase.execute(actor, portfolioId);

    return ok(response, analytics, {
      status: analytics.status,
      baseCurrency: analytics.baseCurrency,
      asOfDate: analytics.snapshot?.asOfDate
    });
  };

  requestRecompute = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requirePortfolioId(request);
    const correlationId = request.header("x-correlation-id") ?? undefined;
    const job = await this.requestPortfolioAnalyticsRecomputeUseCase.execute(
      actor,
      portfolioId,
      correlationId
    );

    return response.status(202).json({
      data: {
        jobId: job.id,
        status: job.status,
        portfolioId: job.portfolioId
      },
      meta: {
        correlationId: job.correlationId
      }
    });
  };

  listHistory = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requirePortfolioId(request);
    const snapshots = await this.listPortfolioAnalyticsHistoryUseCase.execute(actor, portfolioId);

    return ok(response, { snapshots }, { count: snapshots.length });
  };

  getPortfolioCharts = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolioId = requirePortfolioId(request);
    const query = (request as Request & { validatedQuery?: PortfolioChartsQuery })
      .validatedQuery ?? {
      range: "1y",
      interval: "daily"
    };
    const chartResponse = await this.getPortfolioChartsUseCase.execute(
      actor,
      portfolioId,
      query
    );

    return ok(response, chartResponse.data, chartResponse.meta);
  };

  getAnalystCharts = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const chartResponse = await this.getAnalystChartsUseCase.execute(
      actor,
      requireOfficeId(request),
      ((request as Request & { validatedQuery?: AnalystChartsQuery }).validatedQuery ?? {
        range: "1y"
      }) as AnalystChartsQuery
    );

    return ok(response, chartResponse.data, chartResponse.meta);
  };

  createAnalystChartJob = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const job = await this.createAnalystChartJobUseCase.execute(
      actor,
      requireOfficeId(request),
      request.body as AnalystChartsQuery,
      request.header("Idempotency-Key") ?? undefined,
      request.header("x-correlation-id") ?? undefined
    );

    return ok(response.status(202), serializeAnalystChartJob(job), {
      correlationId: job.correlationId,
      inputHash: job.inputHash
    });
  };

  getAnalystChartJob = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const job = await this.getAnalystChartJobUseCase.execute(
      actor,
      requireOfficeId(request),
      requireJobId(request)
    );

    return ok(response, serializeAnalystChartJob(job), {
      correlationId: job.correlationId,
      inputHash: job.inputHash
    });
  };
}

function requirePortfolioId(request: Request): string {
  const { portfolioId } = request.params;

  if (typeof portfolioId !== "string" || portfolioId.length === 0) {
    throw new ApiError(400, "request.invalid_portfolio_id", "Invalid portfolio id");
  }

  return portfolioId;
}

function requireOfficeId(request: Request): string {
  const { officeId } = request.params;

  if (typeof officeId !== "string" || officeId.length === 0) {
    throw new ApiError(400, "request.invalid_office_id", "Invalid office id");
  }

  return officeId;
}

function requireJobId(request: Request): string {
  const { jobId } = request.params;

  if (typeof jobId !== "string" || jobId.length === 0) {
    throw new ApiError(400, "request.invalid_job_id", "Invalid job id");
  }

  return jobId;
}

function serializeAnalystChartJob(job: AnalystChartJob) {
  return {
    ...job,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    expiresAt: job.expiresAt?.toISOString()
  };
}
