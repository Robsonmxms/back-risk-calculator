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
import { buildOperationalChartsContainer } from "./04-infra/container/OperationalChartsContainer";
import { createServer } from "./04-infra/server";

export async function createApp(dependencies: AppDependencies = {}) {
  const config = loadConfig();
  const shared = await buildSharedContainer(config, dependencies);
  const authContainer = buildAuthContainer(shared);
  const userContainer = buildUserContainer(shared);
  const adminContainer = buildAdminContainer(shared);
  const officeContainer = buildOfficeContainer(shared);
  const clientContainer = buildClientContainer(shared);
  const complianceContainer = buildComplianceContainer(shared);
  const accountContainer = buildAccountContainer(shared);
  const portfolioContainer = buildPortfolioContainer(shared);
  const reportsAlertsContainer = buildReportsAlertsContainer(shared, dependencies.reportsAlerts);
  const reportDeliveryContainer = buildReportDeliveryContainer(
    shared,
    reportsAlertsContainer.repository,
    reportsAlertsContainer.notificationRepository
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
  const operationalChartsContainer = buildOperationalChartsContainer(shared, {
    analyticsRepository: analyticsContainer.repository,
    marketDataRepository: marketDataContainer.repository,
    marketDataJobQueue: marketDataContainer.queue,
    reportRepository: reportsAlertsContainer.repository,
    alertRepository: reportsAlertsContainer.alertRepository,
    notificationRepository: reportsAlertsContainer.notificationRepository,
    operationalChartsNow: dependencies.operationalCharts?.operationalChartsNow
  });
  const workbenchContainer = buildWorkbenchContainer(shared, {
    analyticsRepository: analyticsContainer.repository,
    alertRepository: reportsAlertsContainer.alertRepository
  });

  const app = createServer({
    authController: authContainer.controller,
    userController: userContainer.controller,
    adminController: adminContainer.controller,
    officeController: officeContainer.controller,
    clientController: clientContainer.controller,
    operationalChartsController: operationalChartsContainer.controller,
    workbenchController: workbenchContainer.controller,
    complianceController: complianceContainer.controller,
    reportDeliveryController: reportDeliveryContainer.controller,
    accountController: accountContainer.controller,
    portfolioController: portfolioContainer.controller,
    marketDataController: marketDataContainer.controller,
    analyticsController: analyticsContainer.controller,
    reportsAlertsController: reportsAlertsContainer.controller,
    authenticateAccessTokenUseCase: shared.authenticateAccessTokenUseCase,
    corsAllowedOrigins: config.corsAllowedOrigins
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
      getOfficeAdminChartsUseCase:
        operationalChartsContainer.useCases.getOfficeAdminChartsUseCase,
      getPlatformAdminChartsUseCase:
        operationalChartsContainer.useCases.getPlatformAdminChartsUseCase,
      listAuditEventsUseCase: complianceContainer.useCases.listAuditEventsUseCase,
      getComplianceChartsUseCase: complianceContainer.useCases.getComplianceChartsUseCase,
      getDeliveryChartsUseCase: reportDeliveryContainer.useCases.getDeliveryChartsUseCase,
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
