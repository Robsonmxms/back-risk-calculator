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
import { buildAnalyticsContainer } from "./04-infra/container/AnalyticsContainer";
import { buildReportsAlertsContainer } from "./04-infra/container/ReportsAlertsContainer";
import { buildOfficeContainer } from "./04-infra/container/OfficeContainer";
import { buildClientContainer } from "./04-infra/container/ClientContainer";
import { buildWorkbenchContainer } from "./04-infra/container/WorkbenchContainer";
import { buildComplianceContainer } from "./04-infra/container/ComplianceContainer";
import { buildReportDeliveryContainer } from "./04-infra/container/ReportDeliveryContainer";
import { createServer } from "./04-infra/server";

export async function createApp(dependencies: AppDependencies = {}) {
  const config = loadConfig();
  const shared = await buildSharedContainer(config, dependencies);
  const authContainer = buildAuthContainer(shared);
  const userContainer = buildUserContainer(shared);
  const adminContainer = buildAdminContainer(shared);
  const officeContainer = buildOfficeContainer(shared);
  const clientContainer = buildClientContainer(shared);
  const workbenchContainer = buildWorkbenchContainer(shared);
  const complianceContainer = buildComplianceContainer(shared);
  const accountContainer = buildAccountContainer(shared);
  const portfolioContainer = buildPortfolioContainer(shared);
  const reportsAlertsContainer = buildReportsAlertsContainer(shared, dependencies.reportsAlerts);
  const reportDeliveryContainer = buildReportDeliveryContainer(
    shared,
    reportsAlertsContainer.repository
  );
  const marketDataContainer = buildMarketDataContainer(shared, {
    marketDataEventPublisher: reportsAlertsContainer.eventPublisher,
    ...dependencies.marketData
  });
  const analyticsContainer = buildAnalyticsContainer(
    shared,
    marketDataContainer,
    {
      analyticsEventPublisher: reportsAlertsContainer.eventPublisher,
      ...dependencies.analytics
    }
  );

  const app = createServer({
    authController: authContainer.controller,
    userController: userContainer.controller,
    adminController: adminContainer.controller,
    officeController: officeContainer.controller,
    clientController: clientContainer.controller,
    workbenchController: workbenchContainer.controller,
    complianceController: complianceContainer.controller,
    reportDeliveryController: reportDeliveryContainer.controller,
    accountController: accountContainer.controller,
    portfolioController: portfolioContainer.controller,
    marketDataController: marketDataContainer.controller,
    analyticsController: analyticsContainer.controller,
    reportsAlertsController: reportsAlertsContainer.controller,
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
      getPortfolioAnalyticsUseCase:
        analyticsContainer.useCases.getPortfolioAnalyticsUseCase,
      requestPortfolioAnalyticsRecomputeUseCase:
        analyticsContainer.useCases.requestPortfolioAnalyticsRecomputeUseCase,
      listUsersUseCase: adminContainer.useCases.listUsersUseCase,
      listOfficesUseCase: officeContainer.useCases.listOfficesUseCase,
      listClientsUseCase: clientContainer.useCases.listClientsUseCase,
      getWorkbenchUseCase: workbenchContainer.useCases.getWorkbenchUseCase,
      listAuditEventsUseCase: complianceContainer.useCases.listAuditEventsUseCase,
      getClientPortalUseCase: reportDeliveryContainer.useCases.getClientPortalUseCase,
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
    analytics: {
      repository: analyticsContainer.repository,
      worker: analyticsContainer.worker
    },
    reportsAlerts: {
      repository: reportsAlertsContainer.repository,
      reportWorker: reportsAlertsContainer.reportWorker,
      alertEvaluator: reportsAlertsContainer.alertEvaluator,
      realtimeHub: reportsAlertsContainer.realtimeHub
    },
    metrics: shared.metrics
  };
}
