import { Request, Response } from "express";
import {
  GetPortfolioAnalyticsUseCase,
  ListPortfolioAnalyticsHistoryUseCase,
  RequestPortfolioAnalyticsRecomputeUseCase
} from "../../modules/analytics/use-cases";
import { GetPortfolioChartsUseCase } from "../../modules/analytics/chart-use-cases";
import { PortfolioChartsQuery } from "../../modules/analytics/chart-types";
import { AuthenticatedRequest } from "../request";
import { ApiError, ok } from "../http";

export class AnalyticsController {
  constructor(
    private readonly getPortfolioAnalyticsUseCase: GetPortfolioAnalyticsUseCase,
    private readonly requestPortfolioAnalyticsRecomputeUseCase: RequestPortfolioAnalyticsRecomputeUseCase,
    private readonly listPortfolioAnalyticsHistoryUseCase: ListPortfolioAnalyticsHistoryUseCase,
    private readonly getPortfolioChartsUseCase: GetPortfolioChartsUseCase
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
}

function requirePortfolioId(request: Request): string {
  const { portfolioId } = request.params;

  if (typeof portfolioId !== "string" || portfolioId.length === 0) {
    throw new ApiError(400, "request.invalid_portfolio_id", "Invalid portfolio id");
  }

  return portfolioId;
}
