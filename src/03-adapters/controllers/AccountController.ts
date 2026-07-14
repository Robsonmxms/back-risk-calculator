import { ListUserPortfoliosUseCase } from "../../02-application/accounts/use-cases/list-user-portfolios-use-case";
import { GetAccountDashboardUseCase } from "../../02-application/accounts/use-cases/get-account-dashboard-use-case";
import { Request, Response } from "express";
import { GetAccountAnalyticsSummaryUseCase } from "../../02-application/accounts/use-cases/get-account-analytics-summary-use-case";
import { AuthenticatedRequest } from "../request";
import { ApiError, ok } from "../http";

export class AccountController {
  constructor(
    private readonly getAccountAnalyticsSummaryUseCase: GetAccountAnalyticsSummaryUseCase,
    private readonly listUserPortfoliosUseCase: ListUserPortfoliosUseCase,
    private readonly getAccountDashboardUseCase: GetAccountDashboardUseCase
  ) {}

  listPortfolios = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const portfolios = await this.listUserPortfoliosUseCase.execute(actor);

    return ok(
      response,
      { portfolios },
      {
        count: portfolios.length
      }
    );
  };

  getAnalyticsSummary = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const { accountId } = request.params;

    if (typeof accountId !== "string") {
      throw new ApiError(400, "request.invalid_account_id", "Invalid account id");
    }

    return ok(
      response,
      await this.getAccountAnalyticsSummaryUseCase.execute(actor, accountId)
    );
  };

  getDashboard = async (request: Request, response: Response) => {
    const actor = (request as AuthenticatedRequest).actor;
    const { accountId } = request.params;

    if (typeof accountId !== "string") {
      throw new ApiError(400, "request.invalid_account_id", "Invalid account id");
    }

    const dashboard = await this.getAccountDashboardUseCase.execute(actor, accountId);

    return ok(response, dashboard, {
      freshness: dashboard.meta.freshness,
      status: dashboard.meta.status,
      asOf: dashboard.meta.asOf
    );
  };
}
