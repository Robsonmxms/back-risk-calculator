import { AnalyticsController } from "../../03-adapters/controllers/AnalyticsController";
import { PermissionService } from "../../02-application/auth/permission-service";
import { InMemoryAnalystChartJobStore } from "../repositories/InMemoryAnalystChartJobStore";
import { InMemoryAnalyticsStore } from "../repositories/InMemoryAnalyticsStore";
import {
  AnalyticsEventPublisher,
  AnalyticsPortfolioProjection,
  AnalyticsRepository
} from "../../02-application/analytics/ports";
import { AnalystChartJobRepository } from "../../02-application/analytics/analyst-chart-types";
import {
  CreateAnalystChartJobUseCase,
  GetAnalystChartJobUseCase,
  GetAnalystChartsUseCase
} from "../../02-application/analytics/analyst-chart-use-cases";
import {
  GetPortfolioAnalyticsUseCase,
  ListPortfolioAnalyticsHistoryUseCase,
  RequestPortfolioAnalyticsRecomputeUseCase
} from "../../02-application/analytics/use-cases";
import { GetPortfolioChartsUseCase } from "../../02-application/analytics/chart-use-cases";
import { AnalyticsCalculationWorker } from "../analytics/worker";
import type { SharedContainer } from "./SharedContainer";
import type { MarketDataContainer } from "./MarketDataContainer";

export interface AnalyticsContainerDependencies {
  analyticsRepository?: AnalyticsRepository;
  analystChartJobRepository?: AnalystChartJobRepository;
  analyticsEventPublisher?: AnalyticsEventPublisher;
  analyticsPortfolioProjection?: AnalyticsPortfolioProjection;
  analyticsNow?: () => Date;
}

export interface AnalyticsContainer {
  controller: AnalyticsController;
  worker: AnalyticsCalculationWorker;
  repository: AnalyticsRepository;
  analystChartJobRepository: AnalystChartJobRepository;
  useCases: {
    getPortfolioAnalyticsUseCase: GetPortfolioAnalyticsUseCase;
    requestPortfolioAnalyticsRecomputeUseCase: RequestPortfolioAnalyticsRecomputeUseCase;
    listPortfolioAnalyticsHistoryUseCase: ListPortfolioAnalyticsHistoryUseCase;
    getPortfolioChartsUseCase: GetPortfolioChartsUseCase;
    getAnalystChartsUseCase: GetAnalystChartsUseCase;
    createAnalystChartJobUseCase: CreateAnalystChartJobUseCase;
    getAnalystChartJobUseCase: GetAnalystChartJobUseCase;
  };
}

export function buildAnalyticsContainer(
  shared: SharedContainer,
  marketData: MarketDataContainer,
  dependencies: AnalyticsContainerDependencies = {}
): AnalyticsContainer {
  const now = dependencies.analyticsNow ?? (() => new Date());
  const repository = dependencies.analyticsRepository ?? new InMemoryAnalyticsStore();
  const analystChartJobRepository =
    dependencies.analystChartJobRepository ?? new InMemoryAnalystChartJobStore();
  const events =
    dependencies.analyticsEventPublisher ??
    ({
      publish: async (topic, aggregateId, payload) => {
        await shared.identityStore.appendOutboxEvent(topic, aggregateId, payload);
      }
    } satisfies AnalyticsEventPublisher);
  const portfolioProjection = dependencies.analyticsPortfolioProjection ?? shared.identityStore;
  const permissionService = new PermissionService(shared.identityStore, shared.identityStore);

  const getPortfolioAnalyticsUseCase = new GetPortfolioAnalyticsUseCase(
    shared.identityStore,
    shared.identityStore,
    repository
  );
  const requestPortfolioAnalyticsRecomputeUseCase = new RequestPortfolioAnalyticsRecomputeUseCase(
    shared.identityStore,
    shared.identityStore,
    repository,
    events,
    now
  );
  const listPortfolioAnalyticsHistoryUseCase = new ListPortfolioAnalyticsHistoryUseCase(
    shared.identityStore,
    shared.identityStore,
    repository
  );
  const getPortfolioChartsUseCase = new GetPortfolioChartsUseCase(
    shared.identityStore,
    shared.identityStore,
    repository,
    marketData.repository,
    shared.logger,
    shared.metrics,
    now
  );
  const getAnalystChartsUseCase = new GetAnalystChartsUseCase(
    shared.identityStore,
    shared.identityStore,
    shared.identityStore,
    repository,
    marketData.repository,
    permissionService,
    shared.logger,
    shared.metrics,
    now
  );
  const createAnalystChartJobUseCase = new CreateAnalystChartJobUseCase(
    shared.identityStore,
    analystChartJobRepository,
    permissionService,
    events,
    shared.metrics,
    now
  );
  const getAnalystChartJobUseCase = new GetAnalystChartJobUseCase(
    analystChartJobRepository,
    permissionService,
    now
  );
  const worker = new AnalyticsCalculationWorker(
    repository,
    shared.identityStore,
    marketData.repository,
    marketData.provider,
    marketData.currencyRateProvider,
    portfolioProjection,
    events,
    shared.logger,
    shared.metrics,
    now
  );
  const controller = new AnalyticsController(
    getPortfolioAnalyticsUseCase,
    requestPortfolioAnalyticsRecomputeUseCase,
    listPortfolioAnalyticsHistoryUseCase,
    getPortfolioChartsUseCase,
    getAnalystChartsUseCase,
    createAnalystChartJobUseCase,
    getAnalystChartJobUseCase
  );

  return {
    controller,
    worker,
    repository,
    analystChartJobRepository,
    useCases: {
      getPortfolioAnalyticsUseCase,
      requestPortfolioAnalyticsRecomputeUseCase,
      listPortfolioAnalyticsHistoryUseCase,
      getPortfolioChartsUseCase,
      getAnalystChartsUseCase,
      createAnalystChartJobUseCase,
      getAnalystChartJobUseCase
    }
  };
}
