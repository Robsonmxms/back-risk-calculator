import { GetAccountAnalyticsSummaryUseCase } from "../../02-application/accounts/use-cases/get-account-analytics-summary-use-case";
import { AccountController } from "../../03-adapters/controllers/AccountController";
import { SharedContainer } from "./SharedContainer";

export interface AccountContainer {
  controller: AccountController;
  useCases: {
    getAccountAnalyticsSummaryUseCase: GetAccountAnalyticsSummaryUseCase;
  };
}

export function buildAccountContainer(shared: SharedContainer): AccountContainer {
  const getAccountAnalyticsSummaryUseCase = new GetAccountAnalyticsSummaryUseCase(
    shared.identityStore
  );
  const controller = new AccountController(getAccountAnalyticsSummaryUseCase);

  return {
    controller,
    useCases: {
      getAccountAnalyticsSummaryUseCase
    }
  };
}
