import serverless from "serverless-http";
import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, Context } from "aws-lambda";
import { loadRuntimeConfig } from "./04-infra/config/bootstrap";
import type { RuntimeConfig } from "./04-infra/config/RuntimeConfig";
import { buildAccountContainer } from "./04-infra/container/AccountContainer";
import { buildAuthContainer } from "./04-infra/container/AuthContainer";
import { buildSharedContainer } from "./04-infra/container/SharedContainer";
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
import { buildPortfolioImportContainer } from "./04-infra/container/PortfolioImportContainer";
import { createServer } from "./04-infra/server";
import type { AnalyticsContainerDependencies } from "./04-infra/container/AnalyticsContainer";
import type { MarketDataContainerDependencies } from "./04-infra/container/MarketDataContainer";
import type { ReportsAlertsContainerDependencies } from "./04-infra/container/ReportsAlertsContainer";
import type { PortfolioImportContainerDependencies } from "./04-infra/container/PortfolioImportContainer";
import type { InMemoryIdentityStore } from "./04-infra/repositories/InMemoryIdentityStore";

export interface AppDependencies {
  runtimeConfig?: RuntimeConfig;
  identityStore?: InMemoryIdentityStore;
  marketData?: MarketDataContainerDependencies;
  analytics?: AnalyticsContainerDependencies;
  reportsAlerts?: ReportsAlertsContainerDependencies;
  portfolioImports?: PortfolioImportContainerDependencies;
  operationalCharts?: {
    operationalChartsNow?: () => Date;
  };
}

export async function createApp(dependencies: AppDependencies = {}) {
  const config = dependencies.runtimeConfig ?? (await loadRuntimeConfig());
  const shared = await buildSharedContainer(config, { identityStore: dependencies.identityStore });
  const authContainer = buildAuthContainer(shared);
  const userContainer = buildUserContainer(shared);
  const officeContainer = buildOfficeContainer(shared);
  const clientContainer = buildClientContainer(shared);
  const complianceContainer = buildComplianceContainer(shared);
  const accountContainer = buildAccountContainer(shared);
  const portfolioContainer = buildPortfolioContainer(shared);
  const portfolioImportContainer = buildPortfolioImportContainer(
    shared,
    dependencies.portfolioImports
  );
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
  const analyticsContainer = buildAnalyticsContainer(shared, marketDataContainer, {
    analyticsEventPublisher: reportsAlertsContainer.eventPublisher,
    ...dependencies.analytics
  });
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
    userManagementController: userContainer.managementController,
    officeController: officeContainer.controller,
    clientController: clientContainer.controller,
    operationalChartsController: operationalChartsContainer.controller,
    workbenchController: workbenchContainer.controller,
    complianceController: complianceContainer.controller,
    reportDeliveryController: reportDeliveryContainer.controller,
    accountController: accountContainer.controller,
    portfolioController: portfolioContainer.controller,
    portfolioImportController: portfolioImportContainer.controller,
    marketDataController: marketDataContainer.controller,
    analyticsController: analyticsContainer.controller,
    reportsAlertsController: reportsAlertsContainer.controller,
    authenticateAccessTokenUseCase: shared.authenticateAccessTokenUseCase,
    corsAllowedOrigins: config.http.corsAllowedOrigins
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
      listManagedUsersUseCase: userContainer.useCases.listManagedUsersUseCase,
      createManagedUserUseCase: userContainer.useCases.createManagedUserUseCase,
      updateManagedUserUseCase: userContainer.useCases.updateManagedUserUseCase,
      listUserPortfoliosUseCase: accountContainer.useCases.listUserPortfoliosUseCase,
      listVisiblePortfoliosUseCase: portfolioContainer.useCases.listVisiblePortfoliosUseCase,
      searchMarketAssetsUseCase: marketDataContainer.useCases.searchAssetsUseCase,
      requestMarketDataRefreshUseCase: marketDataContainer.useCases.requestRefreshUseCase,
      getPortfolioAnalyticsUseCase: analyticsContainer.useCases.getPortfolioAnalyticsUseCase,
      requestPortfolioAnalyticsRecomputeUseCase:
        analyticsContainer.useCases.requestPortfolioAnalyticsRecomputeUseCase,
      listOfficesUseCase: officeContainer.useCases.listOfficesUseCase,
      listClientsUseCase: clientContainer.useCases.listClientsUseCase,
      getWorkbenchUseCase: workbenchContainer.useCases.getWorkbenchUseCase,
      getOfficeAdminChartsUseCase: operationalChartsContainer.useCases.getOfficeAdminChartsUseCase,
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
    portfolioImports: {
      repository: portfolioImportContainer.repository,
      storage: portfolioImportContainer.storage,
      queue: portfolioImportContainer.queue,
      workbook: portfolioImportContainer.workbook,
      worker: portfolioImportContainer.worker
    },
    metrics: shared.metrics,
    runtimeConfig: config
  };
}

let serverlessAppPromise: ReturnType<typeof createServerlessApp> | undefined;

function createServerlessApp() {
  return createApp().then(({ app }) => serverless(app));
}

export async function handler(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
  context: Context
) {
  context.callbackWaitsForEmptyEventLoop = false;
  serverlessAppPromise ??= createServerlessApp();
  const serverlessApp = await serverlessAppPromise;
  return serverlessApp(event, context);
}

export async function startServer() {
  const { app, runtimeConfig } = await createApp();
  return app.listen(runtimeConfig.runtime.port, () => {
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        message: "api.started",
        port: runtimeConfig.runtime.port
      })}\n`
    );
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
