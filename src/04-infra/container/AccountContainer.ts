import { GetAccountDashboardUseCase } from "../../02-application/accounts/use-cases/get-account-dashboard-use-case";
import { GetAccountAnalyticsSummaryUseCase } from "../../02-application/accounts/use-cases/get-account-analytics-summary-use-case";
import { ListUserPortfoliosUseCase } from "../../02-application/accounts/use-cases/list-user-portfolios-use-case";
import { AccountController } from "../../03-adapters/controllers/AccountController";
import { SharedContainer } from "./SharedContainer";

export interface AccountContainer {
  controller: AccountController;
  useCases: {
    getAccountDashboardUseCase: GetAccountDashboardUseCase;
    getAccountAnalyticsSummaryUseCase: GetAccountAnalyticsSummaryUseCase;
    listUserPortfoliosUseCase: ListUserPortfoliosUseCase;
  };
}

export function buildAccountContainer(shared: SharedContainer): AccountContainer {
  const getAccountDashboardUseCase = new GetAccountDashboardUseCase(shared.identityStore);
  const getAccountAnalyticsSummaryUseCase = new GetAccountAnalyticsSummaryUseCase(
    shared.identityStore
  );
  const listUserPortfoliosUseCase = new ListUserPortfoliosUseCase(shared.identityStore);
  const controller = new AccountController(
    getAccountAnalyticsSummaryUseCase,
    listUserPortfoliosUseCase,
    getAccountDashboardUseCase
  );

  return {
    controller,
    useCases: {
      getAccountDashboardUseCase,
      getAccountAnalyticsSummaryUseCase,
      listUserPortfoliosUseCase
    }
  };
}
