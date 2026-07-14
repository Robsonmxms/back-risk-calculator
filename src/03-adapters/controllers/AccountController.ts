import { Request, Response } from "express";
import { GetAccountAnalyticsSummaryUseCase } from "../../02-application/accounts/use-cases/get-account-analytics-summary-use-case";
import { AuthenticatedRequest } from "../request";
import { ApiError, ok } from "../http";

export class AccountController {
  constructor(
    private readonly getAccountAnalyticsSummaryUseCase: GetAccountAnalyticsSummaryUseCase
  ) {}

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
}
