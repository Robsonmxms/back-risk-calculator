import { loadConfig } from "./04-infra/config/env";
import { buildAccountContainer } from "./04-infra/container/AccountContainer";
import { buildAdminContainer } from "./04-infra/container/AdminContainer";
import { buildAuthContainer } from "./04-infra/container/AuthContainer";
import {
  AppDependencies,
  buildSharedContainer
} from "./04-infra/container/SharedContainer";
import { buildUserContainer } from "./04-infra/container/UserContainer";
import { buildPortfolioContainer } from "./04-infra/container/PortfolioContainer";
import { buildMarketDataContainer } from "./04-infra/container/MarketDataContainer";
import { createServer } from "./04-infra/server";

export async function createApp(dependencies: AppDependencies = {}) {
  const config = loadConfig();
  const shared = await buildSharedContainer(config, dependencies);
  const authContainer = buildAuthContainer(shared);
  const userContainer = buildUserContainer(shared);
  const adminContainer = buildAdminContainer(shared);
  const accountContainer = buildAccountContainer(shared);
  const portfolioContainer = buildPortfolioContainer(shared);
  const marketDataContainer = buildMarketDataContainer(shared, dependencies.marketData);

  const app = createServer({
    authController: authContainer.controller,
    userController: userContainer.controller,
    adminController: adminContainer.controller,
    accountController: accountContainer.controller,
    portfolioController: portfolioContainer.controller,
    marketDataController: marketDataContainer.controller,
    authenticateAccessTokenUseCase: shared.authenticateAccessTokenUseCase
  });

  return {
    app,
    useCases: {
      authenticateAccessTokenUseCase: shared.authenticateAccessTokenUseCase,
      getAccountDashboardUseCase: accountContainer.useCases.getAccountDashboardUseCase,
      getAccountAnalyticsSummaryUseCase:
        accountContainer.useCases.getAccountAnalyticsSummaryUseCase,
      getActorForUserIdUseCase: shared.getActorForUserIdUseCase,
      getCurrentUserUseCase: userContainer.useCases.getCurrentUserUseCase,
      googleLoginUseCase: authContainer.useCases.googleLoginUseCase,
      listUserPortfoliosUseCase: accountContainer.useCases.listUserPortfoliosUseCase,
      listVisiblePortfoliosUseCase: portfolioContainer.useCases.listVisiblePortfoliosUseCase,
      searchMarketAssetsUseCase: marketDataContainer.useCases.searchAssetsUseCase,
      requestMarketDataRefreshUseCase: marketDataContainer.useCases.requestRefreshUseCase,
      listUsersUseCase: adminContainer.useCases.listUsersUseCase,
      loginUseCase: authContainer.useCases.loginUseCase,
      logoutUseCase: authContainer.useCases.logoutUseCase,
      refreshSessionUseCase: authContainer.useCases.refreshSessionUseCase
    },
    marketData: {
      repository: marketDataContainer.repository,
      cache: marketDataContainer.cache,
      queue: marketDataContainer.queue,
      worker: marketDataContainer.worker,
      scheduler: marketDataContainer.scheduler
    },
    metrics: shared.metrics
  };
}
